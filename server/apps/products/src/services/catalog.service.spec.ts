import { NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { ORDERS_PATTERNS } from '@chicago-pizza/common';
import { CatalogService } from './catalog.service';

function productRow(overrides: Record<string, any> = {}) {
  return {
    id: 'p1',
    name: 'Пепперони',
    slug: 'pepperoni',
    description: 'Острая пепперони и моцарелла',
    imageUrl: null,
    type: 'PIZZA',
    basePrice: 39900,
    isVegetarian: false,
    isSpicy: true,
    isNew: false,
    isPopular: true,
    category: { id: 'c1', name: 'Пиццы', slug: 'pizza' },
    sizes: [
      { id: 's45', sizeCm: 45, label: '45 см', price: 63000 },
      { id: 's30', sizeCm: 30, label: '30 см', price: 44000 },
    ],
    productIngredients: [
      { isDefault: true, ingredient: { id: 'i1', name: 'Моцарелла', price: 5000 } },
      { isDefault: false, ingredient: { id: 'i2', name: 'Халапеньо', price: 4000 } },
    ],
    ...overrides,
  };
}

function createService() {
  const prisma: Record<string, any> = {
    category: {
      findMany: jest.fn(async () => [{ id: 'c1' }]),
      create: jest.fn(async ({ data }: any) => data),
    },
    doughType: { findMany: jest.fn(async () => [{ id: 'd1' }]) },
    ingredient: { findMany: jest.fn(async () => [{ id: 'i1' }]) },
    product: {
      findMany: jest.fn(async () => [productRow()]),
      findFirst: jest.fn(async () => ({
        ...productRow(),
        reviews: [{ rating: 5, comment: 'Вкусно', createdAt: new Date() }],
      })),
      count: jest.fn(async () => 1),
      create: jest.fn(async () => productRow()),
      // `updateProduct` reads the old price before writing, so the audit
      // entry can say what it replaced.
      findUnique: jest.fn(async () => ({ basePrice: 40000, isActive: true })),
      update: jest.fn(async () => productRow()),
    },

    favorite: {
      findMany: jest.fn(async () => [{ product: productRow() }]),
      upsert: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };

  // `wrap` is exercised on its own in libs/common; here it must simply not
  // hide the query from the assertions.
  const cache = {
    wrap: jest.fn(async (_key: string, _ttl: number, factory: () => Promise<unknown>) => factory()),
    delByPattern: jest.fn(async () => undefined),
  };

  // Catalog mutations are recorded; the trail must never fail the mutation.
  const audit = { record: jest.fn(async () => undefined) };

  // The order history belongs to another service and is asked for, not read.
  const ordersSend = jest.fn(() => of([] as string[]));
  const orders = { send: ordersSend };

  return {
    service: new CatalogService(prisma as never, cache as never, audit as never, orders as never),
    prisma,
    cache,
    audit,
    ordersSend,
  };
}

const QUERY: Record<string, any> = { page: 1, limit: 20 };

describe('CatalogService — reference lists', () => {
  it.each([
    ['listCategories', 'catalog:categories', 'category', { orderBy: { sortOrder: 'asc' } }],
    ['listDoughTypes', 'catalog:dough', 'doughType', { orderBy: { priceModifier: 'asc' } }],
    ['listIngredients', 'catalog:ingredients', 'ingredient', { orderBy: { name: 'asc' } }],
  ])('%s reads through the cache for five minutes', async (method, key, delegate, args) => {
    const { service, prisma, cache } = createService();

    await (service as never as Record<string, () => Promise<unknown>>)[method]();

    expect(cache.wrap).toHaveBeenCalledWith(key, 300, expect.any(Function));
    expect(prisma[delegate].findMany).toHaveBeenCalledWith(args);
  });
});

describe('CatalogService — listProducts', () => {
  it('only ever returns active products', async () => {
    const { service, prisma } = createService();

    await service.listProducts(QUERY as never);

    expect(prisma.product.findMany.mock.calls[0][0].where).toMatchObject({ isActive: true });
  });

  it('puts popular items first and paginates', async () => {
    const { service, prisma } = createService();

    await service.listProducts({ page: 3, limit: 10 } as never);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ isPopular: 'desc' }, { name: 'asc' }], skip: 20, take: 10 }),
    );
  });

  it('reports the page count', async () => {
    const { service, prisma } = createService();
    prisma.product.count.mockResolvedValue(42);

    await expect(service.listProducts({ page: 1, limit: 20 } as never)).resolves.toMatchObject({
      total: 42,
      page: 1,
      limit: 20,
      totalPages: 3,
    });
  });

  it.each([
    ['categorySlug', { categorySlug: 'pizza' }, { category: { slug: 'pizza' } }],
    ['type', { type: 'DRINK' }, { type: 'DRINK' }],
    ['isVegetarian', { isVegetarian: true }, { isVegetarian: true }],
    ['isSpicy', { isSpicy: false }, { isSpicy: false }],
    ['isHalal', { isHalal: true }, { isHalal: true }],
    ['isNew', { isNew: true }, { isNew: true }],
    ['isPopular', { isPopular: true }, { isPopular: true }],
  ])('filters by %s', async (_label, filter, expected) => {
    const { service, prisma } = createService();

    await service.listProducts({ ...QUERY, ...filter } as never);

    expect(prisma.product.findMany.mock.calls[0][0].where).toMatchObject(expected);
  });

  it('keeps a false flag in the filter rather than dropping it', async () => {
    const { service, prisma } = createService();

    await service.listProducts({ ...QUERY, isVegetarian: false } as never);

    // `if (flag)` here would silently ignore "show me non-vegetarian only".
    expect(prisma.product.findMany.mock.calls[0][0].where).toHaveProperty('isVegetarian', false);
  });

  it('carries the halal flag into every product it serialises', async () => {
    const { service, prisma } = createService();
    prisma.product.findMany.mockResolvedValue([productRow({ isHalal: true })]);

    const { items } = await service.listProducts(QUERY as never);

    // The badge is a claim the customer acts on; it cannot go missing between
    // the column and the card.
    expect(items[0]).toMatchObject({ isHalal: true });
  });

  it('searches name, description and ingredient names case-insensitively', async () => {
    const { service, prisma } = createService();

    await service.listProducts({ ...QUERY, search: 'шампиньоны' } as never);

    expect(prisma.product.findMany.mock.calls[0][0].where.OR).toEqual([
      { name: { contains: 'шампиньоны', mode: 'insensitive' } },
      { description: { contains: 'шампиньоны', mode: 'insensitive' } },
      {
        productIngredients: {
          some: { ingredient: { name: { contains: 'шампиньоны', mode: 'insensitive' } } },
        },
      },
    ]);
  });

  it('caches each distinct query separately', async () => {
    const { service, cache } = createService();

    await service.listProducts({ ...QUERY, search: 'сыр' } as never);
    await service.listProducts({ ...QUERY, search: 'мясо' } as never);

    const [firstKey] = cache.wrap.mock.calls[0];
    const [secondKey] = cache.wrap.mock.calls[1];
    expect(firstKey).not.toBe(secondKey);
  });

  it('serialises sizes ascending and derives the "from" price', async () => {
    const { service } = createService();

    const page = await service.listProducts(QUERY as never);

    expect(page.items[0].sizes.map((s: any) => s.sizeCm)).toEqual([30, 45]);
    expect(page.items[0].priceFrom).toBe(44000);
  });

  it('falls back to the base price for a product without sizes', async () => {
    const { service, prisma } = createService();
    prisma.product.findMany.mockResolvedValue([productRow({ sizes: [] })]);

    const page = await service.listProducts(QUERY as never);

    expect(page.items[0].priceFrom).toBe(39900);
  });

  it('flattens ingredients with their recipe flag', async () => {
    const { service } = createService();

    const page = await service.listProducts(QUERY as never);

    expect(page.items[0].ingredients).toEqual([
      { id: 'i1', name: 'Моцарелла', price: 5000, isDefault: true },
      { id: 'i2', name: 'Халапеньо', price: 4000, isDefault: false },
    ]);
  });

  it('survives a row fetched without its relations', async () => {
    const { service, prisma } = createService();
    prisma.product.findMany.mockResolvedValue([
      { ...productRow(), category: undefined, sizes: undefined, productIngredients: undefined },
    ]);

    const page = await service.listProducts(QUERY as never);

    expect(page.items[0]).toMatchObject({ category: null, sizes: [], ingredients: [], priceFrom: 39900 });
  });

  it('never leaks the raw join rows to the client', async () => {
    const { service } = createService();

    const page = await service.listProducts(QUERY as never);

    expect(page.items[0]).not.toHaveProperty('productIngredients');
    expect(page.items[0]).not.toHaveProperty('basePrice');
  });
});

describe('CatalogService — getProduct', () => {
  it('accepts either a slug or an id and requires the product to be active', async () => {
    const { service, prisma } = createService();

    await service.getProduct('pepperoni');

    expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ slug: 'pepperoni' }, { id: 'pepperoni' }],
      isActive: true,
    });
  });

  it('does not pretend to carry product reviews', async () => {
    const { service } = createService();

    // A review rates an order, not a product: the relation was always empty,
    // so the field is gone rather than permanently blank.
    expect(await service.getProduct('pepperoni')).not.toHaveProperty('reviews');
  });

  it('404s for an unknown or delisted product', async () => {
    const { service, prisma } = createService();
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(service.getProduct('ghost')).rejects.toThrow(NotFoundException);
  });

  it('is not cached, so an admin edit shows up immediately', async () => {
    const { service, cache } = createService();

    await service.getProduct('pepperoni');

    expect(cache.wrap).not.toHaveBeenCalled();
  });
});

describe('CatalogService — recommendations', () => {
  it('shows popular items to a guest', async () => {
    const { service, prisma } = createService();

    const items = await service.recommendations(null);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, isPopular: true }, take: 6 }),
    );
    expect(items[0].id).toBe('p1');
  });

  it('honours the limit', async () => {
    const { service, prisma } = createService();

    await service.recommendations(null, 3);

    expect(prisma.product.findMany.mock.calls[0][0].take).toBe(3);
  });

  /**
   * The history lives in the orders domain. Reading `order_items` from here
   * worked — one database — but made the catalog depend on another service's
   * schema with nothing in this codebase pointing at it.
   */
  it('excludes what the customer has already ordered, asking the orders service', async () => {
    const { service, prisma, ordersSend } = createService();
    ordersSend.mockReturnValue(of(['p1', 'p2']));

    await service.recommendations('user-1');

    expect(ordersSend).toHaveBeenCalledWith(ORDERS_PATTERNS.LIST_ORDERED_PRODUCT_IDS, {
      userId: 'user-1',
    });
    expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      id: { notIn: ['p1', 'p2'] },
    });
  });

  it('does not ask about a guest’s history — there is none', async () => {
    const { service, ordersSend } = createService();

    await service.recommendations(null);

    expect(ordersSend).not.toHaveBeenCalled();
  });

  it('uses a sentinel so a first-time customer still gets suggestions', async () => {
    const { service, prisma } = createService();

    await service.recommendations('user-1');

    // `notIn: []` would match nothing in Prisma, emptying the list.
    expect(prisma.product.findMany.mock.calls[0][0].where.id).toEqual({ notIn: ['__none__'] });
  });
});

describe('CatalogService — favorites', () => {
  it('lists the newest first and serialises the products', async () => {
    const { service, prisma } = createService();

    const items = await service.listFavorites('user-1');

    expect(prisma.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' }, orderBy: { createdAt: 'desc' } }),
    );
    expect(items[0]).toMatchObject({ id: 'p1', priceFrom: 44000 });
  });

  it('adds a favorite idempotently', async () => {
    const { service, prisma } = createService();

    await expect(service.addFavorite('user-1', 'p1')).resolves.toEqual({ success: true });
    expect(prisma.favorite.upsert).toHaveBeenCalledWith({
      where: { userId_productId: { userId: 'user-1', productId: 'p1' } },
      update: {},
      create: { userId: 'user-1', productId: 'p1' },
    });
  });

  it('removing a favorite that is not there is not an error', async () => {
    const { service, prisma } = createService();
    prisma.favorite.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.removeFavorite('user-1', 'p9')).resolves.toEqual({ success: true });
  });
});

describe('CatalogService — admin mutations', () => {
  it('invalidates the catalog cache after creating a category', async () => {
    const { service, cache } = createService();

    await service.createCategory({ name: 'Комбо', slug: 'combo' });

    expect(cache.delByPattern).toHaveBeenCalledWith('catalog:*');
  });

  it('creates a product together with its sizes', async () => {
    const { service, prisma, cache } = createService();

    await service.createProduct({
      name: 'Ойси',
      slug: 'oisi',
      sizes: [{ sizeCm: 30, label: '30 см', price: 46000 }],
    } as never);

    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
      name: 'Ойси',
      sizes: { create: [{ sizeCm: 30, label: '30 см', price: 46000 }] },
    });
    expect(cache.delByPattern).toHaveBeenCalled();
  });

  it('omits the nested create when no sizes are given', async () => {
    const { service, prisma } = createService();

    await service.createProduct({ name: 'Кола', slug: 'cola' } as never);

    expect(prisma.product.create.mock.calls[0][0].data.sizes).toBeUndefined();
  });

  it('omits the nested create for an empty size list', async () => {
    const { service, prisma } = createService();

    await service.createProduct({ name: 'Кола', slug: 'cola', sizes: [] } as never);

    expect(prisma.product.create.mock.calls[0][0].data.sizes).toBeUndefined();
  });

  it('updates a product and drops the cache', async () => {
    const { service, prisma, cache } = createService();

    await service.updateProduct('p1', { name: 'Пепперони XL' } as never);

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { name: 'Пепперони XL' } }),
    );
    expect(cache.delByPattern).toHaveBeenCalled();
  });

  /**
   * There was no way to set a flavour over the API at all. The column, the
   * constructor picker and the order snapshot all existed, and the only thing
   * that could create a variant was the seed script — so "Kinza, six flavours"
   * was a menu feature no administrator could actually use.
   */
  describe('flavours', () => {
    it('creates a product together with its flavours', async () => {
      const { service, prisma } = createService();

      await service.createProduct({
        name: 'Kinza',
        slug: 'kinza',
        variants: [
          { name: 'Кола', slug: 'cola' },
          { name: 'Лимон', slug: 'lemon' },
        ],
      } as never);

      expect(prisma.product.create.mock.calls[0][0].data.variants).toEqual({
        create: [
          { name: 'Кола', slug: 'cola', sortOrder: 0 },
          { name: 'Лимон', slug: 'lemon', sortOrder: 1 },
        ],
      });
    });

    /**
     * The order they were sent in *is* the menu order — that is how somebody
     * types it — so nobody should have to number six drinks by hand.
     */
    it('respects an explicit sortOrder over the position', async () => {
      const { service, prisma } = createService();

      await service.createProduct({
        name: 'Kinza',
        slug: 'kinza',
        variants: [{ name: 'Кола', slug: 'cola', sortOrder: 7 }],
      } as never);

      expect(prisma.product.create.mock.calls[0][0].data.variants.create[0].sortOrder).toBe(7);
    });

    it('omits the nested create for a product sold only one way', async () => {
      const { service, prisma } = createService();

      await service.createProduct({ name: 'Кола', slug: 'cola' } as never);

      expect(prisma.product.create.mock.calls[0][0].data.variants).toBeUndefined();
    });

    it('replaces the whole list on update', async () => {
      const { service, prisma } = createService();

      await service.updateProduct('p1', {
        variants: [{ name: 'Гранат', slug: 'pomegranate' }],
      } as never);

      expect(prisma.product.update.mock.calls[0][0].data.variants).toEqual({
        deleteMany: {},
        create: [{ name: 'Гранат', slug: 'pomegranate', sortOrder: 0 }],
      });
    });

    /**
     * Omitting the field and sending an empty array are different
     * instructions, and both have to stay sayable: "leave the flavours alone"
     * and "this product has none".
     */
    it('leaves the flavours alone when the field is omitted', async () => {
      const { service, prisma } = createService();

      await service.updateProduct('p1', { name: 'Пепперони XL' } as never);

      expect(prisma.product.update.mock.calls[0][0].data.variants).toBeUndefined();
    });

    it('clears the flavours for an empty list', async () => {
      const { service, prisma } = createService();

      await service.updateProduct('p1', { variants: [] } as never);

      expect(prisma.product.update.mock.calls[0][0].data.variants).toEqual({ deleteMany: {}, create: [] });
    });

    it('reports the flavours to the client', async () => {
      const { service, prisma } = createService();
      prisma.product.findFirst.mockResolvedValue(
        productRow({ variants: [{ id: 'v1', name: 'Кола', slug: 'cola' }] }) as never,
      );

      const product = await service.getProduct('kinza');

      expect(product.variants).toEqual([{ id: 'v1', name: 'Кола', slug: 'cola' }]);
    });
  });

  it('delists rather than deletes, so order history survives', async () => {
    const { service, prisma, cache } = createService();

    await expect(service.deleteProduct('p1')).resolves.toEqual({ success: true });

    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isActive: false } });
    expect(cache.delByPattern).toHaveBeenCalledWith('catalog:*');
  });
});

/**
 * `isActive` is a decision about the menu; running out of mozzarella is a
 * fact about tonight. Folding the second into the first is how items get
 * switched off at nine in the evening and quietly stay off for a week.
 */
/**
 * The customer-facing list filters `isActive` and is held for five minutes.
 * Both are right for a menu and wrong for an editor: the item taken off the
 * menu is the one that needs putting back, and a price that reappears as the
 * old one reads as a failed save.
 */
describe('CatalogService — the menu as staff see it', () => {
  it('does not filter by isActive, so a delisted product can be edited', async () => {
    const { service, prisma } = createService();

    await service.adminListProducts({ page: 1, limit: 50 });

    expect(prisma.product.findMany.mock.calls[0][0].where).not.toHaveProperty('isActive');
  });

  it('bypasses the cache entirely', async () => {
    const { service, cache } = createService();

    await service.adminListProducts({ page: 1, limit: 50 });

    expect(cache.wrap).not.toHaveBeenCalled();
  });

  it('reports the stored values a form has to edit, not the derived ones', async () => {
    const { service, prisma } = createService();
    prisma.product.findMany.mockResolvedValue([
      productRow({ isActive: false, basePrice: 13000, categoryId: 'c1' }),
    ] as never);

    const { items } = await service.adminListProducts({ page: 1, limit: 50 });

    expect(items[0]).toMatchObject({ isActive: false, basePrice: 13000, categoryId: 'c1' });
    // And still everything the customer sees, so the two cannot drift.
    expect(items[0]).toHaveProperty('priceFrom');
    expect(items[0]).toHaveProperty('variants');
  });

  it('puts delisted products last, then orders by name', async () => {
    const { service, prisma } = createService();

    await service.adminListProducts({ page: 1, limit: 50 });

    expect(prisma.product.findMany.mock.calls[0][0].orderBy).toEqual([{ isActive: 'desc' }, { name: 'asc' }]);
  });

  it('searches the name and the slug', async () => {
    const { service, prisma } = createService();

    await service.adminListProducts({ page: 1, limit: 50, search: 'kinza' });

    expect(prisma.product.findMany.mock.calls[0][0].where.OR).toEqual([
      { name: { contains: 'kinza', mode: 'insensitive' } },
      { slug: { contains: 'kinza', mode: 'insensitive' } },
    ]);
  });

  it('narrows to one category when asked', async () => {
    const { service, prisma } = createService();

    await service.adminListProducts({ page: 1, limit: 50, categoryId: 'c1' });

    expect(prisma.product.findMany.mock.calls[0][0].where).toMatchObject({ categoryId: 'c1' });
  });
});

describe('CatalogService — the stop list', () => {
  const hour = 60 * 60 * 1000;

  it('stamps the moment an item comes back and logs who stopped it', async () => {
    const { service, prisma, audit } = createService();
    const until = new Date(Date.now() + 2 * hour);

    await service.setStopped('p1', until, 'admin-1');

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { stoppedUntil: until } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PRODUCT_STOPPED', actorId: 'admin-1' }),
    );
  });

  it('records putting an item back as its own action', async () => {
    const { service, audit } = createService();

    await service.setStopped('p1', null, 'admin-1');

    // "Stopped" and "resumed" have to be distinguishable in the trail, or the
    // log cannot answer how long something was actually off.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PRODUCT_RESUMED',
        details: expect.objectContaining({ until: null }),
      }),
    );
  });

  it('drops the cached menu so the change is visible at once', async () => {
    const { service, cache } = createService();

    await service.setStopped('p1', new Date(Date.now() + hour), 'admin-1');

    expect(cache.delByPattern).toHaveBeenCalled();
  });

  it('marks a stopped item unavailable while still listing it', async () => {
    const { service, prisma } = createService();
    prisma.product.findMany.mockResolvedValue([
      productRow({ isActive: true, stoppedUntil: new Date(Date.now() + hour) }),
    ]);

    const { items } = await service.listProducts(QUERY as never);

    // Hiding it would leave a regular wondering where their usual order went.
    expect(items[0]).toMatchObject({ isAvailable: false });
  });

  it('counts an expired stop as available again', async () => {
    const { service, prisma } = createService();
    prisma.product.findMany.mockResolvedValue([
      productRow({ isActive: true, stoppedUntil: new Date(Date.now() - hour) }),
    ]);

    const { items } = await service.listProducts(QUERY as never);

    expect(items[0]).toMatchObject({ isAvailable: true });
  });

  it('lists only what is off right now', async () => {
    const { service, prisma } = createService();

    await service.listStopped();

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, stoppedUntil: { gt: expect.any(Date) } },
      }),
    );
  });
});
