import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
import { IS_PUBLIC_KEY, PRODUCTS_PATTERNS } from '@chicago-pizza/common';
import { CatalogController } from './catalog.controller';
import { RecentReviewsQueryDto } from '../dto/catalog.dto';

function createController(reply: unknown = { items: [] }) {
  const send = jest.fn(() => of(reply));
  const ordersSend = jest.fn(() => of(reply));
  return {
    controller: new CatalogController(
      { send } as unknown as ClientProxy,
      { send: ordersSend } as unknown as ClientProxy,
    ),
    send,
    ordersSend,
  };
}

const meta = (key: string, method: keyof CatalogController) =>
  Reflect.getMetadata(key, CatalogController.prototype[method]);

describe('gateway CatalogController — HTTP surface', () => {
  it.each([
    ['listCategories', 'categories', 0],
    ['listDoughTypes', 'dough-types', 0],
    ['listIngredients', 'ingredients', 0],
    ['listProducts', 'products', 0],
    ['getProduct', 'products/:slugOrId', 0],
    ['price', 'products/price', 1],
    ['recentReviews', 'reviews', 0],
    ['recommendations', 'recommendations', 0],
    ['listFavorites', 'favorites', 0],
    ['addFavorite', 'favorites/:productId', 1],
    ['removeFavorite', 'favorites/:productId', 3],
  ])('%s handles %s', (method, path, httpMethod) => {
    expect(meta('path', method as keyof CatalogController)).toBe(path);
    expect(meta('method', method as keyof CatalogController)).toBe(httpMethod);
  });

  it.each([
    ['listCategories'],
    ['listDoughTypes'],
    ['listIngredients'],
    ['listProducts'],
    ['getProduct'],
    ['price'],
    ['recommendations'],
    ['recentReviews'],
  ])('%s is browsable by a guest', (method) => {
    // The menu must work without an account — that is the whole funnel.
    expect(meta(IS_PUBLIC_KEY, method as keyof CatalogController)).toBe(true);
  });

  it.each([['listFavorites'], ['addFavorite'], ['removeFavorite']])('%s requires a session', (method) => {
    expect(meta(IS_PUBLIC_KEY, method as keyof CatalogController)).toBeUndefined();
  });
});

describe('gateway CatalogController — delegation', () => {
  it.each([
    ['listCategories', PRODUCTS_PATTERNS.LIST_CATEGORIES],
    ['listDoughTypes', PRODUCTS_PATTERNS.LIST_DOUGH_TYPES],
    ['listIngredients', PRODUCTS_PATTERNS.LIST_INGREDIENTS],
  ])('%s asks products for %s', async (method, pattern) => {
    const { controller, send } = createController([]);

    await (controller as never as Record<string, () => Promise<unknown>>)[method]();

    expect(send).toHaveBeenCalledWith(pattern, {});
  });

  it('passes the parsed query straight through', async () => {
    const { controller, send } = createController();
    const query = { page: 2, limit: 10, search: 'сыр' };

    await controller.listProducts(query as never);

    expect(send).toHaveBeenCalledWith(PRODUCTS_PATTERNS.LIST_PRODUCTS, query);
  });

  it('wraps the slug or id from the path', async () => {
    const { controller, send } = createController({ id: 'p1' });

    await controller.getProduct('pepperoni');

    expect(send).toHaveBeenCalledWith(PRODUCTS_PATTERNS.GET_PRODUCT, { slugOrId: 'pepperoni' });
  });

  it('prices a configuration for the live constructor preview', async () => {
    const { controller, send } = createController({ totalPrice: 63000 });
    const config = { productId: 'p1', sizeCm: 45 };

    await controller.price({ config, quantity: 2 } as never);

    expect(send).toHaveBeenCalledWith(PRODUCTS_PATTERNS.PRICE_PIZZA, { config, quantity: 2 });
  });

  it('personalises recommendations for a signed-in visitor', async () => {
    const { controller, send } = createController([]);

    await controller.recommendations({ sub: 'user-1', email: 'a@b.ru', role: 'USER' } as never);

    expect(send).toHaveBeenCalledWith(PRODUCTS_PATTERNS.RECOMMENDATIONS, { userId: 'user-1' });
  });

  it('asks for the guest list when nobody is signed in', async () => {
    const { controller, send } = createController([]);

    await controller.recommendations(undefined);

    // `@Public()` still populates the user when a token is present, so the
    // undefined case has to degrade to a null user id, not crash.
    expect(send).toHaveBeenCalledWith(PRODUCTS_PATTERNS.RECOMMENDATIONS, { userId: null });
  });

  it('asks the orders service for recent reviews, with a default limit', async () => {
    const { controller, ordersSend } = createController([]);

    await controller.recentReviews(new RecentReviewsQueryDto());
    await controller.recentReviews(Object.assign(new RecentReviewsQueryDto(), { limit: 5 }));

    // Reviews rate an order, so they come from the orders service.
    expect(ordersSend).toHaveBeenNthCalledWith(1, 'orders.list_recent_reviews', { limit: 3 });
    expect(ordersSend).toHaveBeenNthCalledWith(2, 'orders.list_recent_reviews', { limit: 5 });
  });

  it('scopes favorites to the authenticated user', async () => {
    const { controller, send } = createController([]);

    await controller.listFavorites({ sub: 'user-1' } as never);
    await controller.addFavorite({ sub: 'user-1' } as never, 'p1');
    await controller.removeFavorite({ sub: 'user-1' } as never, 'p1');

    expect(send).toHaveBeenNthCalledWith(1, PRODUCTS_PATTERNS.LIST_FAVORITES, { userId: 'user-1' });
    expect(send).toHaveBeenNthCalledWith(2, PRODUCTS_PATTERNS.ADD_FAVORITE, { userId: 'user-1', productId: 'p1' });
    expect(send).toHaveBeenNthCalledWith(3, PRODUCTS_PATTERNS.REMOVE_FAVORITE, { userId: 'user-1', productId: 'p1' });
  });
});
