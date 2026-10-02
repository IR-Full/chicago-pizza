import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { AdminAction, Prisma, PrismaService } from '@chicago-pizza/prisma';
import {
  AuditService,
  isOrderable,
  ORDERS_PATTERNS,
  paginate,
  RedisCacheService,
  rpcSend,
} from '@chicago-pizza/common';
import { createHash } from 'crypto';
import { ProductQueryDto } from '../dto/product-query.dto';

const CATALOG_TTL_SECONDS = 300; // 5 min, per the caching requirement

/**
 * How long a *search* result is kept — far shorter than the menu itself.
 *
 * The number of distinct search terms is whatever a caller cares to type, so
 * each one is a cache key somebody else chose. Thirty seconds still absorbs the
 * burst that one visitor's debounced typing produces (and the duplicate requests
 * a results page makes), while keeping what an abusive caller can accumulate to
 * a few seconds' worth rather than five minutes'.
 */
const SEARCH_TTL_SECONDS = 30;
const CACHE_PREFIX = 'catalog';

/**
 * Everything a serialised product needs, in one place.
 *
 * This was written out at each of the seven call sites, and three of them had
 * drifted into mangled indentation from being edited mechanically. Worse than
 * ugly: a read that forgot `variants` loses the flavours silently — the
 * serialiser simply reports an empty list, and the constructor then has
 * nothing to ask the customer about.
 */
const PRODUCT_INCLUDE = {
  sizes: { orderBy: { sizeCm: 'asc' } },
  variants: { orderBy: { sortOrder: 'asc' } },
  category: true,
  productIngredients: { include: { ingredient: true } },
} as const satisfies Prisma.ProductInclude;

/**
 * A flavour as the admin API sends it: a plain row.
 *
 * Deliberately not Prisma's own nested-write shape. `ProductUncheckedCreateInput`
 * already has a `variants` key meaning "a nested create/connect instruction",
 * so intersecting a plain array onto it produces a type nothing can satisfy.
 * The API speaks in rows; translating them into nested writes is this service's
 * job, and `Omit` is what keeps the two vocabularies from colliding.
 */
export interface ProductVariantInput {
  name: string;
  slug: string;
  sortOrder?: number;
}

export type CreateProductInput = Omit<Prisma.ProductUncheckedCreateInput, 'sizes' | 'variants'> & {
  sizes?: { sizeCm: number; label: string; price: number }[];
  variants?: ProductVariantInput[];
};

export type UpdateProductInput = Omit<Prisma.ProductUncheckedUpdateInput, 'variants'> & {
  /** Omit to leave the flavours alone; an empty array means "none". */
  variants?: ProductVariantInput[];
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
    private readonly audit: AuditService,
    @Inject('ORDERS_SERVICE') private readonly orders: ClientProxy,
  ) {}

  listCategories() {
    return this.cache.wrap(`${CACHE_PREFIX}:categories`, CATALOG_TTL_SECONDS, () =>
      this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
    );
  }

  listDoughTypes() {
    return this.cache.wrap(`${CACHE_PREFIX}:dough`, CATALOG_TTL_SECONDS, () =>
      this.prisma.doughType.findMany({ orderBy: { priceModifier: 'asc' } }),
    );
  }

  listIngredients() {
    return this.cache.wrap(`${CACHE_PREFIX}:ingredients`, CATALOG_TTL_SECONDS, () =>
      this.prisma.ingredient.findMany({ orderBy: { name: 'asc' } }),
    );
  }

  async listProducts(query: ProductQueryDto) {
    const cacheKey = `${CACHE_PREFIX}:products:${this.queryFingerprint(query)}`;
    // A free-text search is not cached for as long as the menu is. Hashing the
    // query bounds the *length* of a key, not how many of them a stranger can
    // mint: `?search=<any word>` is an unbounded supply of distinct keys, each
    // holding a page of products for five minutes. With Redis on its default
    // `noeviction` policy that is a way to fill memory until writes start
    // failing — which takes the cart and the session denylist down with it, not
    // just the catalogue. A short window still collapses the burst a real
    // visitor's typing produces, which is what this cache is for.
    const ttl = query.search ? SEARCH_TTL_SECONDS : CATALOG_TTL_SECONDS;

    return this.cache.wrap(cacheKey, ttl, async () => {
      const where = this.buildWhere(query);
      const [items, total] = await Promise.all([
        this.prisma.product.findMany({
          where,
          include: PRODUCT_INCLUDE,
          orderBy: [{ isPopular: 'desc' }, { name: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.prisma.product.count({ where }),
      ]);

      return paginate(
        items.map((p) => this.serializeProduct(p)),
        total,
        query,
      );
    });
  }

  async getProduct(slugOrId: string) {
    const product = await this.prisma.product.findFirst({
      where: { OR: [{ slug: slugOrId }, { id: slugOrId }], isActive: true },
      include: PRODUCT_INCLUDE,
    });
    // Reviews used to be included here, but they rate an order rather than a
    // product and were never linked to one — the list was always empty.
    // Recent reviews now come from the orders service instead.
    if (!product) throw new NotFoundException('Товар не найден');
    return this.serializeProduct(product);
  }

  /**
   * Lightweight "recommendations": most-ordered products the user hasn't
   * tried yet, falling back to popular items. Deliberately not ML — that
   * would need order volume this project doesn't have yet.
   */
  async recommendations(userId: string | null, limit = 6) {
    if (!userId) {
      const popular = await this.prisma.product.findMany({
        where: { isActive: true, isPopular: true },
        include: PRODUCT_INCLUDE,
        take: limit,
      });
      return popular.map((p) => this.serializeProduct(p));
    }

    // The order history belongs to the orders domain. Reading `order_items`
    // from here worked — one database, after all — but it made this service
    // silently depend on another's schema, and the comment at the top of
    // `schema.prisma` claims exactly the opposite.
    const seen = await rpcSend<string[]>(this.orders, ORDERS_PATTERNS.LIST_ORDERED_PRODUCT_IDS, { userId });

    const suggestions = await this.prisma.product.findMany({
      where: { isActive: true, id: { notIn: seen.length ? seen : ['__none__'] } },
      include: PRODUCT_INCLUDE,
      orderBy: [{ isPopular: 'desc' }, { isNew: 'desc' }],
      take: limit,
    });
    return suggestions.map((p) => this.serializeProduct(p));
  }

  // ── Favorites ────────────────────────────────────────────────

  async listFavorites(userId: string) {
    const favorites = await this.prisma.favorite.findMany({
      where: { userId },
      include: {
        product: {
          include: PRODUCT_INCLUDE,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return favorites.map((f) => this.serializeProduct(f.product));
  }

  async addFavorite(userId: string, productId: string) {
    await this.prisma.favorite.upsert({
      where: { userId_productId: { userId, productId } },
      update: {},
      create: { userId, productId },
    });
    return { success: true };
  }

  async removeFavorite(userId: string, productId: string) {
    await this.prisma.favorite.deleteMany({ where: { userId, productId } });
    return { success: true };
  }

  // ── Admin mutations ──────────────────────────────────────────

  async createCategory(
    data: { name: string; slug: string; description?: string; sortOrder?: number },
    actorId?: string,
  ) {
    const category = await this.prisma.category.create({ data });
    await this.audit.record({
      action: AdminAction.CATEGORY_CREATED,
      actorId: actorId ?? null,
      targetType: 'category',
      targetId: category.id,
      details: { name: category.name },
    });
    await this.invalidate();
    return category;
  }

  async createProduct(data: CreateProductInput, actorId?: string) {
    const { sizes, variants, ...productData } = data;
    const product = await this.prisma.product.create({
      data: {
        ...productData,
        sizes: sizes?.length ? { create: sizes } : undefined,
        variants: variants?.length ? { create: this.withOrder(variants) } : undefined,
      },
      include: PRODUCT_INCLUDE,
    });
    await this.audit.record({
      action: AdminAction.PRODUCT_CREATED,
      actorId: actorId ?? null,
      targetType: 'product',
      targetId: product.id,
      details: { name: product.name, basePrice: product.basePrice },
    });
    await this.invalidate();
    return this.serializeProduct(product);
  }

  async updateProduct(productId: string, data: UpdateProductInput, actorId?: string) {
    // Read first: a price change is only meaningful in the log next to the
    // price it replaced.
    const before = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { basePrice: true, isActive: true },
    });

    const { variants, ...productData } = data;

    const product = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...productData,
        // `deleteMany` then `create`, not an upsert-and-prune: a flavour is
        // identified by its slug, and the rows are referenced by nothing —
        // an order line snapshots `variantName`, precisely so the menu can be
        // rewritten without rewriting history. Omitting the field leaves the
        // flavours alone; an empty array means "none", which is a different
        // instruction and has to stay sayable.
        ...(variants ? { variants: { deleteMany: {}, create: this.withOrder(variants) } } : {}),
      },
      include: PRODUCT_INCLUDE,
    });

    await this.audit.record({
      action: AdminAction.PRODUCT_UPDATED,
      actorId: actorId ?? null,
      targetType: 'product',
      targetId: productId,
      details: {
        priceFrom: before?.basePrice ?? null,
        priceTo: product.basePrice,
        activeFrom: before?.isActive ?? null,
        activeTo: product.isActive,
      },
    });
    await this.invalidate();
    return this.serializeProduct(product);
  }

  /**
   * Takes an item off the menu for a while, or puts it back.
   *
   * Deliberately not `isActive`: delisting is a decision about the menu, and
   * running out of mozzarella is a fact about tonight. Conflating them is how
   * items get switched off at nine in the evening and quietly stay off for a
   * week.
   *
   * Nothing has to switch them back on either — a timestamp in the past stops
   * matching by itself, so the item returns at the moment it was promised.
   */
  async setStopped(productId: string, stoppedUntil: Date | null, actorId?: string) {
    const product = await this.prisma.product.update({
      where: { id: productId },
      data: { stoppedUntil },
      include: PRODUCT_INCLUDE,
    });

    await this.audit.record({
      action: stoppedUntil ? AdminAction.PRODUCT_STOPPED : AdminAction.PRODUCT_RESUMED,
      actorId: actorId ?? null,
      targetType: 'product',
      targetId: productId,
      details: { name: product.name, until: stoppedUntil?.toISOString() ?? null },
    });

    await this.invalidate();
    return this.serializeProduct(product);
  }

  /**
   * The menu as staff see it, for the editor.
   *
   * Three deliberate differences from `listProducts`, which answers customers:
   *
   *  - Delisted items are included. They are the ones most likely to be edited —
   *    putting something back on the menu is impossible from a list that hides
   *    everything taken off it.
   *  - Not cached. The customer-facing list is held for five minutes, which is
   *    right for a menu and wrong for a form: saving a price and seeing the old
   *    one come back reads as the save having failed.
   *  - `isActive` and `basePrice` come through raw, which the public shape
   *    deliberately hides behind `isAvailable` and `priceFrom`. A form has to
   *    show the stored value, not a figure derived from it.
   */
  async adminListProducts(query: { page: number; limit: number; search?: string; categoryId?: string }) {
    const where: Prisma.ProductWhereInput = {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        // Delisted items last, then alphabetical: the editor is browsed by eye.
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(
      items.map((product) => this.serializeForAdmin(product)),
      total,
      query,
    );
  }

  /** What is off the menu right now, for the kitchen's own screen. */
  async listStopped() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, stoppedUntil: { gt: new Date() } },
      include: PRODUCT_INCLUDE,
      orderBy: { name: 'asc' },
    });

    return products.map((product) => this.serializeProduct(product));
  }

  async deleteProduct(productId: string, actorId?: string) {
    // Soft delete: order items reference products historically, so a hard
    // delete would break order history.
    await this.prisma.product.update({ where: { id: productId }, data: { isActive: false } });
    await this.audit.record({
      action: AdminAction.PRODUCT_DELISTED,
      actorId: actorId ?? null,
      targetType: 'product',
      targetId: productId,
    });
    await this.invalidate();
    return { success: true };
  }

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * Numbers the flavours by the order they were sent in, unless the caller
   * said otherwise.
   *
   * The list in the request *is* the menu order — that is how someone types
   * it — so defaulting `sortOrder` to the position means an administrator
   * never has to number six drinks by hand to get them to come out in the
   * order they wrote them.
   */
  private withOrder(variants: ProductVariantInput[]) {
    return variants.map((variant, index) => ({
      name: variant.name,
      slug: variant.slug,
      sortOrder: variant.sortOrder ?? index,
    }));
  }

  /**
   * A fixed-length key for a catalog query.
   *
   * The key used to be the query object serialised whole, so an attacker with
   * a word list could mint an unbounded number of distinct keys — each one a
   * full page of products held in Redis for five minutes. Hashing bounds the
   * key; including every field keeps two different filters from colliding
   * onto one cached answer, which would be the worse failure.
   */
  private queryFingerprint(query: ProductQueryDto): string {
    return createHash('sha1').update(JSON.stringify(query)).digest('hex');
  }

  private buildWhere(query: ProductQueryDto): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { isActive: true };

    if (query.categorySlug) where.category = { slug: query.categorySlug };
    if (query.type) where.type = query.type;
    if (query.isVegetarian !== undefined) where.isVegetarian = query.isVegetarian;
    if (query.isSpicy !== undefined) where.isSpicy = query.isSpicy;
    if (query.isHalal !== undefined) where.isHalal = query.isHalal;
    if (query.isNew !== undefined) where.isNew = query.isNew;
    if (query.isPopular !== undefined) where.isPopular = query.isPopular;

    if (query.search) {
      // Search covers product name/description and ingredient names, so
      // "грибы" finds every pizza containing mushrooms.
      //
      // `contains` is an unindexed ILIKE '%x%' across three tables. That is a
      // deliberate trade for a menu of a few dozen items — cheaper than a
      // pg_trgm GIN index to build and keep. Revisit if the catalog grows by
      // an order of magnitude.
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        {
          productIngredients: {
            some: { ingredient: { name: { contains: query.search, mode: 'insensitive' } } },
          },
        },
      ];
    }

    return where;
  }

  private serializeProduct(product: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    imageUrl: string | null;
    type: string;
    basePrice: number;
    isVegetarian: boolean;
    isSpicy: boolean;
    isHalal: boolean;
    isActive?: boolean;
    stoppedUntil?: Date | null;
    isNew: boolean;
    isPopular: boolean;
    category?: { id: string; name: string; slug: string } | null;
    sizes?: { id: string; sizeCm: number; label: string; price: number }[];
    variants?: { id: string; name: string; slug: string }[];
    productIngredients?: { isDefault: boolean; ingredient: { id: string; name: string; price: number } }[];
  }) {
    const sizes = (product.sizes ?? []).slice().sort((a, b) => a.sizeCm - b.sizeCm);
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      imageUrl: product.imageUrl,
      type: product.type,
      isVegetarian: product.isVegetarian,
      isSpicy: product.isSpicy,
      isHalal: product.isHalal,
      // Listed but not orderable: the kitchen has run out. Hiding it instead
      // would leave a regular wondering where their usual order went.
      isAvailable: isOrderable({ isActive: product.isActive ?? true, stoppedUntil: product.stoppedUntil }),
      stoppedUntil: product.stoppedUntil ?? null,
      isNew: product.isNew,
      isPopular: product.isPopular,
      category: product.category ?? null,
      sizes,
      // Flavours, when the product is sold in several. Empty for everything
      // else, so the UI can simply ask whether the list has anything in it.
      variants: (product.variants ?? []).map((v) => ({ id: v.id, name: v.name, slug: v.slug })),
      // Cheapest purchasable price, used for the "from N ₽" label on cards.
      priceFrom: sizes.length ? sizes[0].price : product.basePrice,
      ingredients: (product.productIngredients ?? []).map((pi) => ({
        id: pi.ingredient.id,
        name: pi.ingredient.name,
        price: pi.ingredient.price,
        isDefault: pi.isDefault,
      })),
    };
  }

  /**
   * The public shape plus the three fields a form needs to edit rather than
   * display.
   *
   * Built on top of `serializeProduct` instead of replacing it, so the editor
   * cannot drift from what the customer sees: a field added to one appears in
   * the other. What it adds is the stored truth behind two derived values —
   * `isAvailable` folds `isActive` together with the stop list, and `priceFrom`
   * hides `basePrice` behind the cheapest size — plus `categoryId`, because a
   * `<select>` needs the id and the public shape carries the whole category.
   */
  private serializeForAdmin(
    product: Parameters<CatalogService['serializeProduct']>[0] & {
      categoryId: string;
      isActive: boolean;
      basePrice: number;
    },
  ) {
    return {
      ...this.serializeProduct(product),
      categoryId: product.categoryId,
      isActive: product.isActive,
      basePrice: product.basePrice,
    };
  }

  private invalidate() {
    return this.cache.delByPattern(`${CACHE_PREFIX}:*`);
  }
}
