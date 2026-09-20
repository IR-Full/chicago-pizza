import { ORDERS_PATTERNS } from '@chicago-pizza/common';
import { OrdersController } from './orders.controller';
import { CartService } from './services/cart.service';
import { OrderService } from './services/order.service';
import { PromocodeService } from './services/promocode.service';
import { LoyaltyService } from './services/loyalty.service';

function createController() {
  const cart: Record<string, any> = {
    getCart: jest.fn(async () => ({ lines: [] })),
    addItem: jest.fn(async () => ({ lines: [] })),
    updateItem: jest.fn(async () => ({ lines: [] })),
    removeItem: jest.fn(async () => ({ lines: [] })),
    clear: jest.fn(async () => ({ lines: [] })),
  };
  const orders: Record<string, any> = {
    checkout: jest.fn(async () => ({ id: 'order-1' })),
    listOrders: jest.fn(async () => ({ items: [] })),
    getOrder: jest.fn(async () => ({ id: 'order-1' })),
    repeatOrder: jest.fn(async () => ({ lines: [] })),
    submitReview: jest.fn(async () => ({ success: true })),
    listRecentReviews: jest.fn(async () => []),
    adminListOrders: jest.fn(async () => ({ items: [] })),
    updateStatus: jest.fn(async () => ({ id: 'order-1' })),
  };
  const promocodes: Record<string, any> = {
    validate: jest.fn(async () => ({ discount: 0 })),
    list: jest.fn(async () => []),
    create: jest.fn(async () => ({ id: 'promo-1' })),
  };
  const loyalty: Record<string, any> = {
    getSummary: jest.fn(async () => ({ points: 0 })),
    getReferralInfo: jest.fn(async () => ({ invited: 0 })),
  };

  return {
    controller: new OrdersController(
      cart as unknown as CartService,
      orders as unknown as OrderService,
      promocodes as unknown as PromocodeService,
      loyalty as unknown as LoyaltyService,
    ),
    cart,
    orders,
    promocodes,
    loyalty,
  };
}

const patternOf = (method: keyof OrdersController): string[] =>
  ([] as string[]).concat(Reflect.getMetadata('microservices:pattern', OrdersController.prototype[method]));

describe('OrdersController — message routing', () => {
  const routes: [keyof OrdersController, string][] = [
    ['getCart', ORDERS_PATTERNS.GET_CART],
    ['addCartItem', ORDERS_PATTERNS.ADD_CART_ITEM],
    ['updateCartItem', ORDERS_PATTERNS.UPDATE_CART_ITEM],
    ['removeCartItem', ORDERS_PATTERNS.REMOVE_CART_ITEM],
    ['clearCart', ORDERS_PATTERNS.CLEAR_CART],
    ['applyPromocode', ORDERS_PATTERNS.APPLY_PROMOCODE],
    ['checkout', ORDERS_PATTERNS.CHECKOUT],
    ['listOrders', ORDERS_PATTERNS.LIST_ORDERS],
    ['getOrder', ORDERS_PATTERNS.GET_ORDER],
    ['repeatOrder', ORDERS_PATTERNS.REPEAT_ORDER],
    ['submitReview', ORDERS_PATTERNS.SUBMIT_REVIEW],
    ['listRecentReviews', ORDERS_PATTERNS.LIST_RECENT_REVIEWS],
    ['getLoyalty', ORDERS_PATTERNS.GET_LOYALTY],
    ['getReferralInfo', ORDERS_PATTERNS.GET_REFERRAL_INFO],
    ['adminListOrders', ORDERS_PATTERNS.ADMIN_LIST_ORDERS],
    ['adminUpdateStatus', ORDERS_PATTERNS.ADMIN_UPDATE_STATUS],
    ['adminListPromocodes', ORDERS_PATTERNS.ADMIN_LIST_PROMOCODES],
    ['adminCreatePromocode', ORDERS_PATTERNS.ADMIN_CREATE_PROMOCODE],
  ];

  it.each(routes)('%s listens on %s', (method, pattern) => {
    expect(patternOf(method)).toContain(pattern);
  });
});

describe('OrdersController — cart delegation', () => {
  it('reads the cart of the payload user', async () => {
    const { controller, cart } = createController();

    await controller.getCart({ userId: 'user-1' });

    expect(cart.getCart).toHaveBeenCalledWith('user-1');
  });

  it('splits user, configuration and quantity when adding', async () => {
    const { controller, cart } = createController();
    const config = { productId: 'p1', sizeCm: 45 };

    await controller.addCartItem({ userId: 'user-1', config: config as never, quantity: 2 });

    expect(cart.addItem).toHaveBeenCalledWith('user-1', config, 2);
  });

  it('updates and removes by line id', async () => {
    const { controller, cart } = createController();

    await controller.updateCartItem({ userId: 'user-1', lineId: 'l1', quantity: 3 });
    await controller.removeCartItem({ userId: 'user-1', lineId: 'l1' });

    expect(cart.updateItem).toHaveBeenCalledWith('user-1', 'l1', 3);
    expect(cart.removeItem).toHaveBeenCalledWith('user-1', 'l1');
  });

  it('clears the cart', async () => {
    const { controller, cart } = createController();

    await controller.clearCart({ userId: 'user-1' });

    expect(cart.clear).toHaveBeenCalledWith('user-1');
  });

  it('validates a promocode against the current subtotal and customer', async () => {
    const { controller, promocodes } = createController();

    await controller.applyPromocode({ code: 'CHICAGO10', subtotal: 100_000, userId: 'user-1' });

    // The customer is needed for the per-account limit.
    expect(promocodes.validate).toHaveBeenCalledWith('CHICAGO10', 100_000, 'user-1');
  });
});

describe('OrdersController — order delegation', () => {
  it('splits user and checkout body', async () => {
    const { controller, orders } = createController();
    const dto = { addressId: 'addr-1', deliveryType: 'ASAP' };

    await controller.checkout({ userId: 'user-1', dto: dto as never });

    expect(orders.checkout).toHaveBeenCalledWith('user-1', dto);
  });

  it('passes pagination through, including when it is absent', async () => {
    const { controller, orders } = createController();

    await controller.listOrders({ userId: 'user-1', page: 2, limit: 5 });
    await controller.listOrders({ userId: 'user-1' });

    expect(orders.listOrders).toHaveBeenNthCalledWith(1, 'user-1', 2, 5);
    expect(orders.listOrders).toHaveBeenNthCalledWith(2, 'user-1', undefined, undefined);
  });

  it('carries the caller role so staff can read any order', async () => {
    const { controller, orders } = createController();

    await controller.getOrder({ userId: 'user-1', orderId: 'order-1', role: 'COURIER' as never });

    expect(orders.getOrder).toHaveBeenCalledWith('user-1', 'order-1', 'COURIER');
  });

  it('repeats an order and submits a review', async () => {
    const { controller, orders } = createController();

    await controller.repeatOrder({ userId: 'user-1', orderId: 'order-1' });
    await controller.submitReview({ userId: 'user-1', orderId: 'order-1', rating: 5, comment: 'Вкусно' });

    expect(orders.repeatOrder).toHaveBeenCalledWith('user-1', 'order-1');
    expect(orders.submitReview).toHaveBeenCalledWith('user-1', 'order-1', 5, 'Вкусно');
  });

  it('asks for recent reviews, with and without a limit', async () => {
    const { controller, orders } = createController();

    await controller.listRecentReviews({ limit: 5 });
    await controller.listRecentReviews({});

    expect(orders.listRecentReviews).toHaveBeenNthCalledWith(1, 5);
    expect(orders.listRecentReviews).toHaveBeenNthCalledWith(2, undefined);
  });

  it('allows a review without a comment', async () => {
    const { controller, orders } = createController();

    await controller.submitReview({ userId: 'user-1', orderId: 'order-1', rating: 4 });

    expect(orders.submitReview).toHaveBeenCalledWith('user-1', 'order-1', 4, undefined);
  });
});

describe('OrdersController — loyalty and staff delegation', () => {
  it('reads the loyalty summary and referral info', async () => {
    const { controller, loyalty } = createController();

    await controller.getLoyalty({ userId: 'user-1' });
    await controller.getReferralInfo({ userId: 'user-1' });

    expect(loyalty.getSummary).toHaveBeenCalledWith('user-1');
    expect(loyalty.getReferralInfo).toHaveBeenCalledWith('user-1');
  });

  it('forwards the admin order filter', async () => {
    const { controller, orders } = createController();

    await controller.adminListOrders({
      page: 1,
      limit: 20,
      status: 'PREPARING' as never,
      actorId: 'admin-1',
      actorRole: 'ADMIN' as never,
    });

    expect(orders.adminListOrders).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      status: 'PREPARING',
      // Scoping happens in the service; the controller passes the caller on.
      actorId: 'admin-1',
      actorRole: 'ADMIN',
    });
  });

  it('records who changed the status', async () => {
    const { controller, orders } = createController();

    await controller.adminUpdateStatus({ orderId: 'order-1', status: 'DELIVERED' as never, changedById: 'admin-1' });

    expect(orders.updateStatus).toHaveBeenCalledWith('order-1', 'DELIVERED', 'admin-1');
  });

  it('lists promocodes', async () => {
    const { controller, promocodes } = createController();

    await controller.adminListPromocodes();

    expect(promocodes.list).toHaveBeenCalledWith();
  });

  it('parses the expiry date when creating a promocode', async () => {
    const { controller, promocodes } = createController();

    await controller.adminCreatePromocode({
      code: 'CHICAGO10',
      discountType: 'PERCENT' as never,
      discountValue: 10,
      expiresAt: '2026-12-31T20:59:00.000Z',
    });

    // The actor is a separate argument, not part of the promocode data.
    expect(promocodes.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CHICAGO10', expiresAt: new Date('2026-12-31T20:59:00.000Z') }),
      undefined,
    );
  });

  it('leaves the expiry undefined for an open-ended promocode', async () => {
    const { controller, promocodes } = createController();

    await controller.adminCreatePromocode({ code: 'FOREVER', discountType: 'FIXED' as never, discountValue: 10_000 });

    expect(promocodes.create.mock.calls[0][0].expiresAt).toBeUndefined();
  });
});
