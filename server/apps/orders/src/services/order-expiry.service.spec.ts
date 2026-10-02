import { OrderService } from './order.service';
import { OrderExpiryService } from './order-expiry.service';

/**
 * Checkout creates the order and *then* sends the customer to the bank, so an
 * order nobody pays for is a real row holding real things: the loyalty points
 * it spent and one use of the promocode it applied. It sat in `CREATED`
 * forever, and the kitchen board hides unpaid online orders — so it was
 * immortal *and* invisible, which is why nobody was ever going to notice it.
 */

interface Fixture {
  stale?: Record<string, unknown>[];
  /** Rows the conditional cancellation matched. 0 = the payment landed first. */
  transitionCount?: number;
}

function createService(fixture: Fixture = {}) {
  const stale = fixture.stale ?? [{ id: 'order-1', userId: 'user-1', promocodeId: 'promo-1' }];

  const prisma: Record<string, any> = {
    order: {
      findMany: jest.fn(async () => stale),
      updateMany: jest.fn(async () => ({ count: fixture.transitionCount ?? 1 })),
    },
    orderStatusHistory: { create: jest.fn(async () => ({})) },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));

  const loyalty = { refundForCancelledOrder: jest.fn(async () => 0) };
  const promocodes = { release: jest.fn(async () => undefined) };
  const notifications = { emit: jest.fn() };
  const realtime = { emit: jest.fn() };

  const orders = new OrderService(
    prisma as never,
    {} as never,
    promocodes as never,
    loyalty as never,
    { record: jest.fn() } as never,
    {} as never,
    { isEnabled: false } as never,
    { send: jest.fn() } as never,
    notifications as never,
    realtime as never,
  );

  return { orders, sweeper: new OrderExpiryService(orders), prisma, loyalty, promocodes, notifications, realtime };
}

describe('expiring online orders nobody paid for', () => {
  it('cancels an order left unpaid', async () => {
    const { orders, prisma } = createService();

    await expect(orders.expireUnpaidOnlineOrders()).resolves.toEqual({ cancelled: 1 });

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'CREATED' },
      data: { status: 'CANCELLED' },
    });
  });

  it('looks only at online orders still waiting, past the deadline, and not paid', async () => {
    const { orders, prisma } = createService();

    await orders.expireUnpaidOnlineOrders();

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'CREATED',
          paymentMethod: 'ONLINE',
          createdAt: { lt: expect.any(Date) },
          NOT: { payment: { is: { status: 'SUCCEEDED' } } },
        }),
      }),
    );
  });

  it('gives back the points and the promocode use the order was holding', async () => {
    const { orders, loyalty, promocodes } = createService();

    await orders.expireUnpaidOnlineOrders();

    expect(loyalty.refundForCancelledOrder).toHaveBeenCalledWith(expect.anything(), 'user-1', 'order-1');
    expect(promocodes.release).toHaveBeenCalledWith(expect.anything(), 'promo-1', 'order-1');
  });

  it('records the cancellation with no author, because the clock did it', async () => {
    const { orders, prisma } = createService();

    await orders.expireUnpaidOnlineOrders();

    expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: 'CANCELLED', changedById: null },
    });
  });

  it('tells the customer their order is off', async () => {
    const { orders, notifications, realtime } = createService();

    await orders.expireUnpaidOnlineOrders();

    for (const bus of [notifications, realtime]) {
      expect(bus.emit).toHaveBeenCalledWith(
        'order.status.changed',
        expect.objectContaining({ orderId: 'order-1', userId: 'user-1', status: 'CANCELLED' }),
      );
    }
  });

  /**
   * A payment landing while the sweep runs must win — the guard on `CREATED` is
   * what makes that happen, and the order has to survive untouched.
   */
  it('leaves an order alone when the payment lands first', async () => {
    const { orders, loyalty, notifications } = createService({ transitionCount: 0 });

    await expect(orders.expireUnpaidOnlineOrders()).resolves.toEqual({ cancelled: 0 });

    expect(loyalty.refundForCancelledOrder).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing to expire', async () => {
    const { orders, prisma } = createService({ stale: [] });

    await expect(orders.expireUnpaidOnlineOrders()).resolves.toEqual({ cancelled: 0 });
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('keeps going past an order it cannot cancel', async () => {
    const { orders, prisma } = createService({
      stale: [
        { id: 'bad', userId: 'user-1', promocodeId: null },
        { id: 'good', userId: 'user-2', promocodeId: null },
      ],
    });
    prisma.$transaction.mockImplementationOnce(async () => {
      throw new Error('deadlock');
    });

    await expect(orders.expireUnpaidOnlineOrders()).resolves.toEqual({ cancelled: 1 });
  });
});

describe('the sweep schedule', () => {
  it('runs the expiry rule', async () => {
    const { sweeper } = createService();

    await expect(sweeper.sweep()).resolves.toEqual({ cancelled: 1 });
  });

  /**
   * An unhandled rejection in a scheduled job is invisible, and in some
   * runtimes it takes the timer down with it.
   */
  it('swallows a failure rather than letting the timer die', async () => {
    const { sweeper, orders } = createService();
    jest.spyOn(orders, 'expireUnpaidOnlineOrders').mockRejectedValue(new Error('database gone'));

    await expect(sweeper.sweep()).resolves.toEqual({ cancelled: 0 });
  });
});
