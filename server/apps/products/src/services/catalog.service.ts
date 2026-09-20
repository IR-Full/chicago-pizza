import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminAction, Prisma, PrismaService } from '@chicago-pizza/prisma';
import { AuditService, paginate, RedisCacheService } from '@chicago-pizza/common';
import { createHash } from 'crypto';
import { ProductQueryDto } from '../dto/product-query.dto';

const CATALOG_TTL_SECONDS = 300; // 5 min, per the caching requirement
const CACHE_PREFIX = 'catalog';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
    private readonly audit: AuditService,
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

    return this.cache.wrap(cacheKey, CATALOG_TTL_SECONDS, async () => {
      const where = this.buildWhere(query);
      const [items, total] = await Promise.all([
        this.prisma.product.findMany({
          where,
          include: {
            sizes: { orderBy: { sizeCm: 'asc' } },
            category: true,
            productIngredients: { include: { ingredient: true } },
          },
          orderBy: [{ isPopular: 'desc' }, { name: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.prisma.product.count({ where }),
      ]);

      return paginate(items.map((p) => this.serializeProduct(p)), total, query);
    });
  }

  async getProduct(slugOrId: string) {
    const product = await this.prisma.product.findFirst({
      where: { OR: [{ slug: slugOrId }, { id: slugOrId }], isActive: true },
      include: {
        sizes: { orderBy: { sizeCm: 'asc' } },
        category: true,
        productIngredients: { include: { ingredient: true } },
      },
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
        include: { sizes: true, category: true, productIngredients: { include: { ingredient: true } } },
        take: limit,
      });
      return popular.map((p) => this.serializeProduct(p));
    }

    const orderedProductIds = await this.prisma.orderItem.findMany({
      where: { order: { userId } },
      select: { productId: true },
      distinct: ['productId'],
    });
    const seen = orderedProductIds.map((o) => o.productId);

    const suggestions = await this.prisma.product.findMany({
      where: { isActive: true, id: { notIn: seen.length ? seen : ['__none__'] } },
      include: { sizes: true, category: true, productIngredients: { include: { ingredient: true } } },
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
          include: { sizes: true, category: true, productIngredients: { include: { ingredient: true } } },
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

  async createProduct(
    data: Prisma.ProductUncheckedCreateInput & { sizes?: { sizeCm: number; label: string; price: number }[] },
    actorId?: string,
  ) {
    const { sizes, ...productData } = data;
    const product = await this.prisma.product.create({
      data: { ...productData, sizes: sizes?.length ? { create: sizes } : undefined },
      include: { sizes: true, category: true, productIngredients: { include: { ingredient: true } } },
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

  async updateProduct(productId: string, data: Prisma.ProductUncheckedUpdateInput, actorId?: string) {
    // Read first: a price change is only meaningful in the log next to the
    // price it replaced.
    const before = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { basePrice: true, isActive: true },
    });

    const product = await this.prisma.product.update({
      where: { id: productId },
      data,
      include: { sizes: true, category: true, productIngredients: { include: { ingredient: true } } },
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
        { productIngredients: { some: { ingredient: { name: { contains: query.search, mode: 'insensitive' } } } } },
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
    isNew: boolean;
    isPopular: boolean;
    category?: { id: string; name: string; slug: string } | null;
    sizes?: { id: string; sizeCm: number; label: string; price: number }[];
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
      isNew: product.isNew,
      isPopular: product.isPopular,
      category: product.category ?? null,
      sizes,
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

  private invalidate() {
    return this.cache.delByPattern(`${CACHE_PREFIX}:*`);
  }
}
