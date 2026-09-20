import { PRODUCTS_PATTERNS } from '@chicago-pizza/common';
import { ProductsController } from './products.controller';
import { CatalogService } from './services/catalog.service';
import { PricingService } from './services/pricing.service';

function createController() {
  const catalog: Record<string, any> = {
    listCategories: jest.fn(async () => []),
    listDoughTypes: jest.fn(async () => []),
    listIngredients: jest.fn(async () => []),
    listProducts: jest.fn(async () => ({ items: [] })),
    getProduct: jest.fn(async () => ({ id: 'p1' })),
    recommendations: jest.fn(async () => []),
    listFavorites: jest.fn(async () => []),
    addFavorite: jest.fn(async () => ({ success: true })),
    removeFavorite: jest.fn(async () => ({ success: true })),
    createCategory: jest.fn(async () => ({ id: 'c1' })),
    createProduct: jest.fn(async () => ({ id: 'p1' })),
    updateProduct: jest.fn(async () => ({ id: 'p1' })),
    deleteProduct: jest.fn(async () => ({ success: true })),
  };
  const pricing: Record<string, any> = {
    priceOne: jest.fn(async () => ({ totalPrice: 63000 })),
    priceItems: jest.fn(async () => []),
  };

  return {
    controller: new ProductsController(catalog as unknown as CatalogService, pricing as unknown as PricingService),
    catalog,
    pricing,
  };
}

const patternOf = (method: keyof ProductsController): string[] =>
  ([] as string[]).concat(Reflect.getMetadata('microservices:pattern', ProductsController.prototype[method]));

describe('ProductsController — message routing', () => {
  const routes: [keyof ProductsController, string][] = [
    ['listCategories', PRODUCTS_PATTERNS.LIST_CATEGORIES],
    ['listDoughTypes', PRODUCTS_PATTERNS.LIST_DOUGH_TYPES],
    ['listIngredients', PRODUCTS_PATTERNS.LIST_INGREDIENTS],
    ['listProducts', PRODUCTS_PATTERNS.LIST_PRODUCTS],
    ['getProduct', PRODUCTS_PATTERNS.GET_PRODUCT],
    ['pricePizza', PRODUCTS_PATTERNS.PRICE_PIZZA],
    ['validateOrderItems', PRODUCTS_PATTERNS.VALIDATE_ORDER_ITEMS],
    ['recommendations', PRODUCTS_PATTERNS.RECOMMENDATIONS],
    ['listFavorites', PRODUCTS_PATTERNS.LIST_FAVORITES],
    ['addFavorite', PRODUCTS_PATTERNS.ADD_FAVORITE],
    ['removeFavorite', PRODUCTS_PATTERNS.REMOVE_FAVORITE],
    ['createCategory', PRODUCTS_PATTERNS.ADMIN_CREATE_CATEGORY],
    ['createProduct', PRODUCTS_PATTERNS.ADMIN_CREATE_PRODUCT],
    ['updateProduct', PRODUCTS_PATTERNS.ADMIN_UPDATE_PRODUCT],
    ['deleteProduct', PRODUCTS_PATTERNS.ADMIN_DELETE_PRODUCT],
  ];

  it.each(routes)('%s listens on %s', (method, pattern) => {
    expect(patternOf(method)).toContain(pattern);
  });
});

describe('ProductsController — catalog delegation', () => {
  it.each([['listCategories'], ['listDoughTypes'], ['listIngredients']])(
    '%s takes no payload and forwards straight to the catalog',
    async (method) => {
      const { controller, catalog } = createController();

      await (controller as never as Record<string, () => Promise<unknown>>)[method]();

      expect(catalog[method]).toHaveBeenCalledWith();
    },
  );

  it('passes the query through to the catalog', async () => {
    const { controller, catalog } = createController();

    await controller.listProducts({ page: 2, limit: 10, search: 'сыр' } as never);

    expect(catalog.listProducts).toHaveBeenCalledWith({ page: 2, limit: 10, search: 'сыр' });
  });

  it('unwraps the slug or id', async () => {
    const { controller, catalog } = createController();

    await controller.getProduct({ slugOrId: 'pepperoni' });

    expect(catalog.getProduct).toHaveBeenCalledWith('pepperoni');
  });

  it('forwards the recommendation request including a guest', async () => {
    const { controller, catalog } = createController();

    await controller.recommendations({ userId: null, limit: 4 });
    await controller.recommendations({ userId: 'user-1' });

    expect(catalog.recommendations).toHaveBeenNthCalledWith(1, null, 4);
    expect(catalog.recommendations).toHaveBeenNthCalledWith(2, 'user-1', undefined);
  });
});

describe('ProductsController — pricing delegation', () => {
  it('prices a single configured pizza', async () => {
    const { controller, pricing } = createController();
    const config = { productId: 'p1', sizeCm: 45 };

    await controller.pricePizza({ config: config as never, quantity: 2 });

    expect(pricing.priceOne).toHaveBeenCalledWith(config, 2);
  });

  it('re-prices a whole cart for the orders service', async () => {
    const { controller, pricing } = createController();
    const items = [{ config: { productId: 'p1' }, quantity: 1 }];

    await controller.validateOrderItems({ items: items as never });

    expect(pricing.priceItems).toHaveBeenCalledWith(items);
  });
});

describe('ProductsController — favorites and admin delegation', () => {
  it('splits user and product for favorites', async () => {
    const { controller, catalog } = createController();

    await controller.listFavorites({ userId: 'user-1' });
    await controller.addFavorite({ userId: 'user-1', productId: 'p1' });
    await controller.removeFavorite({ userId: 'user-1', productId: 'p1' });

    expect(catalog.listFavorites).toHaveBeenCalledWith('user-1');
    expect(catalog.addFavorite).toHaveBeenCalledWith('user-1', 'p1');
    expect(catalog.removeFavorite).toHaveBeenCalledWith('user-1', 'p1');
  });

  /**
   * The actor rides alongside the payload rather than inside it: the catalog
   * writes an audit entry, and a price change with no author explains nothing
   * six months later.
   */
  it('creates a category from the payload, naming who did it', async () => {
    const { controller, catalog } = createController();

    await controller.createCategory({ name: 'Комбо', slug: 'combo', actorId: 'admin-1' });

    expect(catalog.createCategory).toHaveBeenCalledWith({ name: 'Комбо', slug: 'combo' }, 'admin-1');
  });

  it('creates a product from the payload, naming who did it', async () => {
    const { controller, catalog } = createController();
    const payload = { name: 'Ойси', slug: 'oisi', sizes: [{ sizeCm: 30, label: '30 см', price: 46000 }] };

    await controller.createProduct({ ...payload, actorId: 'admin-1' } as never);

    expect(catalog.createProduct).toHaveBeenCalledWith(payload, 'admin-1');
  });

  it('splits id, patch and actor when updating', async () => {
    const { controller, catalog } = createController();

    await controller.updateProduct({ productId: 'p1', data: { isPopular: true } as never, actorId: 'admin-1' });

    expect(catalog.updateProduct).toHaveBeenCalledWith('p1', { isPopular: true }, 'admin-1');
  });

  it('unwraps the id when delisting', async () => {
    const { controller, catalog } = createController();

    await controller.deleteProduct({ productId: 'p1', actorId: 'admin-1' });

    expect(catalog.deleteProduct).toHaveBeenCalledWith('p1', 'admin-1');
  });
});
