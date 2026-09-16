import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma delegate mocks */

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
    category: { findMany: jest.fn(async () => [{ id: 'c1' }]), create: jest.fn(async ({ data }: any) => data) },
    doughType: { findMany: jest.fn(async () => [{ id: 'd1' }]) },
    ingredient: { findMany: jest.fn(async () => [{ id: 'i1' }]) },
    product: {
      findMany: jest.fn(async () => [productRow()]),
      findFirst: jest.fn(async () => ({ ...productRow(), reviews: [{ rating: 5, comment: 'Вкусно', createdAt: new Date() }] })),
      count: jest.fn(async () => 1),
      create: jest.fn(async () => productRow()),
      update: jest.fn(async () => productRow()),
    },
    orderItem: { findMany: jest.fn(async () => []) },
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

  return { service: new CatalogService(prisma as never, cache as never), prisma, cache };
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

  it('searches name, description and ingredient names case-insensitively', async () => {
    const { service, prisma } = createService();

    await service.listProducts({ ...QUERY, search: 'шампиньоны' } as never);

    expect(prisma.product.findMany.mock.calls[0][0].where.OR).toEqual([
      { name: { contains: 'шампиньоны', mode: 'insensitive' } },
      { description: { contains: 'шампиньоны', mode: 'insensitive' } },
      { productIngredients: { some: { ingredient: { name: { contains: 'шампиньоны', mode: 'insensitive' } } } } },
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

  it('includes the latest reviews', async () => {
    const { service } = createService();

    const product = await service.getProduct('pepperoni');

    expect(product.reviews).toHaveLength(1);
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

  it('excludes what the customer has already ordered', async () => {
    const { service, prisma } = createService();
    prisma.orderItem.findMany.mockResolvedValue([{ productId: 'p1' }, { productId: 'p2' }]);

    await service.recommendations('user-1');

    expect(prisma.orderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { order: { userId: 'user-1' } }, distinct: ['productId'] }),
    );
    expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      id: { notIn: ['p1', 'p2'] },
    });
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

  it('delists rather than deletes, so order history survives', async () => {
    const { service, prisma, cache } = createService();

    await expect(service.deleteProduct('p1')).resolves.toEqual({ success: true });

    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isActive: false } });
    expect(cache.delByPattern).toHaveBeenCalledWith('catalog:*');
  });
});
