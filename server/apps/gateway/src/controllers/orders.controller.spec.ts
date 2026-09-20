import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
import { IS_PUBLIC_KEY, ORDERS_PATTERNS, PaginationDto } from '@chicago-pizza/common';
import { OrdersController } from './orders.controller';

function createController(reply: unknown = { ok: true }) {
  const send = jest.fn(() => of(reply));
  return { controller: new OrdersController({ send } as unknown as ClientProxy), send };
}

const meta = (key: string, method: keyof OrdersController) =>
  Reflect.getMetadata(key, OrdersController.prototype[method]);

const USER = { sub: 'user-1', email: 'a@b.ru', role: 'USER' } as never;

describe('gateway OrdersController — HTTP surface', () => {
  it.each([
    ['getCart', 'cart', 0],
    ['addItem', 'cart/items', 1],
    ['updateItem', 'cart/items/:lineId', 4],
    ['removeItem', 'cart/items/:lineId', 3],
    ['clearCart', 'cart', 3],
    ['applyPromocode', 'cart/promocode', 1],
    ['checkout', 'orders', 1],
    ['listOrders', 'orders', 0],
    ['getOrder', 'orders/:id', 0],
    ['repeatOrder', 'orders/:id/repeat', 1],
    ['submitReview', 'orders/:id/review', 1],
    ['getLoyalty', 'loyalty', 0],
    ['getReferrals', 'referrals', 0],
  ])('%s handles %s', (method, path, httpMethod) => {
    expect(meta('path', method as keyof OrdersController)).toBe(path);
    expect(meta('method', method as keyof OrdersController)).toBe(httpMethod);
  });

  it('exposes nothing to anonymous callers', () => {
    // A cart belongs to an account; none of these may be @Public().
    const methods: (keyof OrdersController)[] = [
      'getCart',
      'addItem',
      'updateItem',
      'removeItem',
      'clearCart',
      'applyPromocode',
      'checkout',
      'listOrders',
      'getOrder',
      'repeatOrder',
      'submitReview',
      'getLoyalty',
      'getReferrals',
    ];

    for (const method of methods) {
      expect(meta(IS_PUBLIC_KEY, method)).toBeUndefined();
    }
  });
});

describe('gateway OrdersController — cart', () => {
  it('reads the caller’s cart', async () => {
    const { controller, send } = createController();

    await controller.getCart(USER);

    expect(send).toHaveBeenCalledWith(ORDERS_PATTERNS.GET_CART, { userId: 'user-1' });
  });

  it('splits the body into configuration and quantity', async () => {
    const { controller, send } = createController();
    const config = { productId: 'p1', sizeCm: 45 };

    await controller.addItem(USER, { config, quantity: 2 } as never);

    expect(send).toHaveBeenCalledWith(ORDERS_PATTERNS.ADD_CART_ITEM, {
      userId: 'user-1',
      config,
      quantity: 2,
    });
  });

  it('takes the line id from the path and the quantity from the body', async () => {
    const { controller, send } = createController();

    await controller.updateItem(USER, 'line-1', { quantity: 3 } as never);

    expect(send).toHaveBeenCalledWith(ORDERS_PATTERNS.UPDATE_CART_ITEM, {
      userId: 'user-1',
      lineId: 'line-1',
      quantity: 3,
    });
  });

  it('removes a line and clears the cart', async () => {
    const { controller, send } = createController();

    await controller.removeItem(USER, 'line-1');
    await controller.clearCart(USER);

    expect(send).toHaveBeenNthCalledWith(1, ORDERS_PATTERNS.REMOVE_CART_ITEM, {
      userId: 'user-1',
      lineId: 'line-1',
    });
    expect(send).toHaveBeenNthCalledWith(2, ORDERS_PATTERNS.CLEAR_CART, { userId: 'user-1' });
  });

  it('checks a promocode against the server-side subtotal, not a client number', async () => {
    const send = jest
      .fn()
      .mockReturnValueOnce(of({ subtotal: 123_000 }))
      .mockReturnValueOnce(of({ discount: 12_300 }));
    const controller = new OrdersController({ send } as unknown as ClientProxy);

    await controller.applyPromocode(USER, { code: 'CHICAGO10' } as never);

    expect(send).toHaveBeenNthCalledWith(1, ORDERS_PATTERNS.GET_CART, { userId: 'user-1' });
    expect(send).toHaveBeenNthCalledWith(2, ORDERS_PATTERNS.APPLY_PROMOCODE, {
      code: 'CHICAGO10',
      subtotal: 123_000,
      userId: 'user-1',
    });
  });
});

describe('gateway OrdersController — orders', () => {
  it('sends the checkout body under the caller', async () => {
    const { controller, send } = createController();
    const dto = { addressId: 'addr-1', deliveryType: 'ASAP' };

    await controller.checkout(USER, dto as never);

    expect(send).toHaveBeenCalledWith(ORDERS_PATTERNS.CHECKOUT, { userId: 'user-1', dto });
  });

  it('defaults the history to the first page of twenty', async () => {
    const { controller, send } = createController();

    await controller.listOrders(USER, new PaginationDto());

    expect(send).toHaveBeenCalledWith(ORDERS_PATTERNS.LIST_ORDERS, { userId: 'user-1', page: 1, limit: 20 });
  });

  it('converts the query strings to numbers', async () => {
    const { controller, send } = createController();

    await controller.listOrders(USER, Object.assign(new PaginationDto(), { page: 3, limit: 5 }));

    expect(send).toHaveBeenCalledWith(ORDERS_PATTERNS.LIST_ORDERS, { userId: 'user-1', page: 3, limit: 5 });
  });

  it('carries the caller role so staff can open any order', async () => {
    const { controller, send } = createController();

    await controller.getOrder({ sub: 'staff-1', role: 'COURIER' } as never, 'order-1');

    expect(send).toHaveBeenCalledWith(ORDERS_PATTERNS.GET_ORDER, {
      userId: 'staff-1',
      orderId: 'order-1',
      role: 'COURIER',
    });
  });

  it('repeats an order and submits a review', async () => {
    const { controller, send } = createController();

    await controller.repeatOrder(USER, 'order-1');
    await controller.submitReview(USER, 'order-1', { rating: 5, comment: 'Вкусно' } as never);

    expect(send).toHaveBeenNthCalledWith(1, ORDERS_PATTERNS.REPEAT_ORDER, {
      userId: 'user-1',
      orderId: 'order-1',
    });
    expect(send).toHaveBeenNthCalledWith(2, ORDERS_PATTERNS.SUBMIT_REVIEW, {
      userId: 'user-1',
      orderId: 'order-1',
      rating: 5,
      comment: 'Вкусно',
    });
  });

  it('reads loyalty and referral data for the caller', async () => {
    const { controller, send } = createController();

    await controller.getLoyalty(USER);
    await controller.getReferrals(USER);

    expect(send).toHaveBeenNthCalledWith(1, ORDERS_PATTERNS.GET_LOYALTY, { userId: 'user-1' });
    expect(send).toHaveBeenNthCalledWith(2, ORDERS_PATTERNS.GET_REFERRAL_INFO, { userId: 'user-1' });
  });
});
