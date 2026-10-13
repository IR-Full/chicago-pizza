import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';

/**
 * Focused on the order status state machine and access control — the parts
 * where a bug would let a customer see someone else's order or a courier
 * rewind a delivered order.
 */

function createService(
  overrides: {
    order?: Record<string, unknown> | null;
    /** How many rows the conditional status update matched. 0 = someone else
     *  already moved the order on. */
    transitionCount?: number;
  } = {},
) {
  const order =
    overrides.order === undefined ? { id: 'order-1', userId: 'user-1', status: 'CREATED' } : overrides.order;

  let nextStatus = 'CREATED';
  const updateMock = jest.fn(({ data }: { data: { status: string } }) => {
    nextStatus = data.status;
    return { count: overrides.transitionCount ?? 1 };
  });

  const prisma: Record<string, unknown> = {
    payment: { findUnique: jest.fn(async () => null) },
    eventOutbox: { createMany: jest.fn(async () => ({ count: 2 })) },
    $queryRaw: jest.fn(async () => []),
    order: {
      findUnique: jest.fn(() => order),
      findFirst: jest.fn(() => order),
      updateMany: updateMock,
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(() => ({
        id: 'order-1',
        userId: 'user-1',
        status: nextStatus,
        // 1000 ₽ of food, 200 ₽ off, 150 ₽ delivery.
        subtotal: 100_000,
        discount: 20_000,
        deliveryFee: 15_000,
        total: 95_000,
        updatedAt: new Date('2026-09-16T10:00:00.000Z'),
        items: [],
        statusHistory: [],
      })),
    },
    orderStatusHistory: { create: jest.fn() },
    loyaltyTransaction: { create: jest.fn() },
    user: { findUniqueOrThrow: jest.fn(() => ({ id: 'user-1', loyaltyLevel: 'BRONZE', loyaltyPoints: 0 })) },
    referral: { findUnique: jest.fn(() => null) },
  };
  // $transaction receives a callback and runs it against the same client.
  prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));

  const loyalty = {
    awardForOrder: jest.fn(),
    settleReferral: jest.fn(),
    redeemPoints: jest.fn(),
    refundForCancelledOrder: jest.fn(async () => 0),
  };

  const promocodes = { validate: jest.fn(), redeem: jest.fn(), release: jest.fn(async () => undefined) };

  const notifications = { emit: jest.fn() };
  // The gateway consumes the same events and turns them into WebSocket pushes.
  const realtime = { emit: jest.fn() };

  const audit = { record: jest.fn(async () => undefined) };

  // Stands in for Redis. `setIfAbsent` answers true — nobody holds the key —
  // unless a test says otherwise.
  const cache = {
    setIfAbsent: jest.fn(async () => true),
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    del: jest.fn(async () => undefined),
  };

  /**
   * Online payment is off unless a test says otherwise. `refundForCancelledOrder`
   * is still here: cancelling now asks for the money back, and a stub without
   * it would make every cancellation log a swallowed TypeError instead of
   * exercising the call.
   */
  const payments = {
    isEnabled: false,
    refundForCancelledOrder: jest.fn(async () => ({ refunded: false, amount: 0 })),
  };

  const service = new OrderService(
    prisma as never,
    { getRawLines: jest.fn(() => []), clear: jest.fn(), replaceLines: jest.fn() } as never,
    promocodes as never,
    loyalty as never,
    audit as never,
    cache as never,
    payments as never,
    { send: jest.fn() } as never,
    notifications as never,
    realtime as never,
  );

  return {
    service,
    prisma,
    loyalty,
    promocodes,
    audit,
    cache,
    notifications,
    realtime,
    payments,
    updateMock,
  };
}

/** The common case: an administrator, who may make any legal transition. */
const asAdmin = (orderId: string, status: string) =>
  ({ orderId, status, actorId: 'admin-1', actorRole: 'ADMIN' }) as never;

const asCourier = (orderId: string, status: string, courierId = 'courier-1') =>
  ({ orderId, status, actorId: courierId, actorRole: 'COURIER' }) as never;

describe('OrderService — status transitions', () => {
  it.each([
    ['CREATED', 'ACCEPTED'],
    ['ACCEPTED', 'PREPARING'],
    ['PREPARING', 'ON_DELIVERY'],
    ['ON_DELIVERY', 'DELIVERED'],
    ['CREATED', 'CANCELLED'],
    ['PREPARING', 'CANCELLED'],
  ])('allows %s → %s', async (from, to) => {
    const { service } = createService({ order: { id: 'order-1', userId: 'user-1', status: from } });

    await expect(service.updateStatus(asAdmin('order-1', to))).resolves.toMatchObject({
      status: to,
    });
  });

  it.each([
    ['DELIVERED', 'PREPARING'],
    ['DELIVERED', 'CANCELLED'],
    ['CANCELLED', 'ACCEPTED'],
    ['CREATED', 'DELIVERED'],
    ['CREATED', 'ON_DELIVERY'],
  ])('rejects %s → %s', async (from, to) => {
    const { service } = createService({ order: { id: 'order-1', userId: 'user-1', status: from } });

    await expect(service.updateStatus(asAdmin('order-1', to))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown order', async () => {
    const { service } = createService({ order: null });

    await expect(service.updateStatus(asAdmin('missing', 'ACCEPTED'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('awards loyalty and settles referrals only on DELIVERED', async () => {
    const { service, loyalty } = createService({
      order: { id: 'order-1', userId: 'user-1', status: 'ON_DELIVERY' },
    });

    await service.updateStatus(asAdmin('order-1', 'DELIVERED'));

    expect(loyalty.awardForOrder).toHaveBeenCalledTimes(1);
    expect(loyalty.settleReferral).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });

  /**
   * Cashback used to be a percentage of `total`, which bundles in the
   * delivery fee and is already net of the points spent — so the shop paid
   * cashback on its own delivery charge, and points earned points.
   */
  it('awards cashback on what was paid for food, not on the total', async () => {
    const { service, loyalty } = createService({
      order: { id: 'order-1', userId: 'user-1', status: 'ON_DELIVERY' },
    });

    await service.updateStatus(asAdmin('order-1', 'DELIVERED'));

    expect(loyalty.awardForOrder).toHaveBeenCalledWith(expect.anything(), 'user-1', 'order-1', 80_000);
  });

  it('does not award loyalty on intermediate statuses', async () => {
    const { service, loyalty } = createService({
      order: { id: 'order-1', userId: 'user-1', status: 'ACCEPTED' },
    });

    await service.updateStatus(asAdmin('order-1', 'PREPARING'));

    expect(loyalty.awardForOrder).not.toHaveBeenCalled();
  });

  it('persists the status event for notifications', async () => {
    const { service, prisma } = createService({
      order: { id: 'order-1', userId: 'user-1', status: 'CREATED' },
    });
    await service.updateStatus(asAdmin('order-1', 'ACCEPTED'));
    expect((prisma.eventOutbox as any).createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          destination: 'notifications',
          event: 'order.status.changed',
          payload: expect.objectContaining({
            orderId: 'order-1',
            status: 'ACCEPTED',
            updatedAt: expect.any(String),
          }),
        }),
      ]),
    });
  });

  /**
   * A queue delivers each message to one consumer, so the event has to be
   * published to both: notifications writes the row and sends the letter, the
   * gateway pushes it down the socket. Publishing to one of them is how the
   * bell stayed stale while the email arrived — or the other way round.
   */
  it('persists the status event for realtime', async () => {
    const { service, prisma } = createService({
      order: { id: 'order-1', userId: 'user-1', status: 'CREATED' },
    });
    await service.updateStatus(asAdmin('order-1', 'ACCEPTED'));
    expect((prisma.eventOutbox as any).createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          destination: 'realtime',
          event: 'order.status.changed',
          payload: expect.objectContaining({
            orderId: 'order-1',
            status: 'ACCEPTED',
            updatedAt: expect.any(String),
          }),
        }),
      ]),
    });
  });
});

/**
 * The write path used to accept any staff id without looking at the role, so
 * a courier could cancel a stranger's order or mark someone else's delivery
 * complete — which also pays out cashback and settles a referral.
 */
describe('OrderService — who may move an order', () => {
  const delivery = (fields: Record<string, unknown>) => ({
    id: 'order-1',
    userId: 'user-1',
    ...fields,
  });

  it('lets a courier take an unassigned delivery', async () => {
    const { service } = createService({
      order: delivery({ status: 'PREPARING', courierId: null }),
    });

    await expect(service.updateStatus(asCourier('order-1', 'ON_DELIVERY'))).resolves.toMatchObject({
      status: 'ON_DELIVERY',
    });
  });

  it('lets a courier finish the delivery that is theirs', async () => {
    const { service } = createService({
      order: delivery({ status: 'ON_DELIVERY', courierId: 'courier-1' }),
    });

    await expect(service.updateStatus(asCourier('order-1', 'DELIVERED'))).resolves.toMatchObject({
      status: 'DELIVERED',
    });
  });

  it('stops a courier from snatching a delivery assigned to a colleague', async () => {
    const { service } = createService({
      order: delivery({ status: 'PREPARING', courierId: 'courier-2' }),
    });

    await expect(service.updateStatus(asCourier('order-1', 'ON_DELIVERY'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('stops a courier from completing someone else’s delivery — and paying out its cashback', async () => {
    const { service, loyalty } = createService({
      order: delivery({ status: 'ON_DELIVERY', courierId: 'courier-2' }),
    });

    await expect(service.updateStatus(asCourier('order-1', 'DELIVERED'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(loyalty.awardForOrder).not.toHaveBeenCalled();
  });

  it.each([['CREATED'], ['ACCEPTED'], ['PREPARING'], ['ON_DELIVERY']])(
    'stops a courier from cancelling a %s order',
    async (from) => {
      const { service } = createService({
        order: delivery({ status: from, courierId: 'courier-1' }),
      });

      await expect(service.updateStatus(asCourier('order-1', 'CANCELLED'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it.each([['ACCEPTED'], ['PREPARING']])('stops a courier from running the kitchen (→ %s)', async (to) => {
    const from = to === 'ACCEPTED' ? 'CREATED' : 'ACCEPTED';
    const { service } = createService({ order: delivery({ status: from, courierId: null }) });

    await expect(service.updateStatus(asCourier('order-1', to))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a role that has no business moving orders at all', async () => {
    const { service } = createService({ order: delivery({ status: 'CREATED', courierId: null }) });

    await expect(
      service.updateStatus({
        orderId: 'order-1',
        status: 'ACCEPTED',
        actorId: 'support-1',
        actorRole: 'SUPPORT',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks the transition before the role, so an illegal jump stays a 400', async () => {
    const { service } = createService({
      order: delivery({ status: 'DELIVERED', courierId: 'courier-2' }),
    });

    await expect(service.updateStatus(asCourier('order-1', 'PREPARING'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('OrderService — access control', () => {
  it('lets the owner read their order', async () => {
    const { service } = createService({ order: { id: 'order-1', userId: 'user-1', status: 'CREATED' } });

    await expect(service.getOrder('user-1', 'order-1', 'USER' as never)).resolves.toMatchObject({
      id: 'order-1',
    });
  });

  it.each(['ADMIN', 'SUPPORT'])('lets %s read any order', async (role) => {
    const { service } = createService({
      order: { id: 'order-1', userId: 'someone-else', status: 'CREATED' },
    });

    await expect(service.getOrder('staff-1', 'order-1', role as never)).resolves.toMatchObject({
      id: 'order-1',
    });
  });

  /**
   * "Any staff role may read any order" was one condition doing the work of
   * three. A courier needs the address and phone of the delivery in their
   * hands — not of every order the shop has ever taken.
   */
  it('lets a courier read the delivery assigned to them', async () => {
    const { service } = createService({
      order: { id: 'order-1', userId: 'someone-else', status: 'ON_DELIVERY', courierId: 'courier-1' },
    });

    await expect(service.getOrder('courier-1', 'order-1', 'COURIER' as never)).resolves.toMatchObject({
      id: 'order-1',
    });
  });

  it('lets a courier read an unclaimed order that is still live', async () => {
    const { service } = createService({
      order: { id: 'order-1', userId: 'someone-else', status: 'PREPARING', courierId: null },
    });

    await expect(service.getOrder('courier-1', 'order-1', 'COURIER' as never)).resolves.toMatchObject({
      id: 'order-1',
    });
  });

  it("blocks a courier from reading someone else's delivery", async () => {
    const { service } = createService({
      order: { id: 'order-1', userId: 'someone-else', status: 'ON_DELIVERY', courierId: 'courier-9' },
    });

    await expect(service.getOrder('courier-1', 'order-1', 'COURIER' as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks a courier from trawling finished orders', async () => {
    const { service } = createService({
      order: { id: 'order-1', userId: 'someone-else', status: 'DELIVERED', courierId: null },
    });

    // Delivered orders are a customer database with the addresses attached.
    await expect(service.getOrder('courier-1', 'order-1', 'COURIER' as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("blocks a customer from reading another customer's order", async () => {
    const { service } = createService({
      order: { id: 'order-1', userId: 'someone-else', status: 'CREATED' },
    });

    await expect(service.getOrder('user-1', 'order-1', 'USER' as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('OrderService — reviews', () => {
  it('rejects a rating outside 1..5', async () => {
    const { service } = createService();

    await expect(service.submitReview('user-1', 'order-1', 6)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.submitReview('user-1', 'order-1', 0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects reviewing an order that is not delivered yet', async () => {
    const { service } = createService({ order: { id: 'order-1', userId: 'user-1', status: 'PREPARING' } });

    await expect(service.submitReview('user-1', 'order-1', 5)).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * Refusing to let a customer undo their own order does not prevent the
 * cancellation — it moves it to the phone, where the shop cancels it anyway,
 * only slower and with an irritated customer on the line. The cut-off is the
 * oven: after that the ingredients are spent.
 */
describe('OrderService — cancelling as the customer', () => {
  function cancellable(status: string, fields: Record<string, unknown> = {}) {
    return createService({ order: { id: 'order-1', userId: 'user-1', status, ...fields } });
  }

  it.each([['CREATED'], ['ACCEPTED']])('lets the customer call off a %s order', async (status) => {
    const { service } = cancellable(status);

    await expect(service.cancelByCustomer('user-1', 'order-1')).resolves.toMatchObject({
      status: 'CANCELLED',
    });
  });

  it.each([['PREPARING'], ['ON_DELIVERY']])('refuses once the kitchen has it (%s)', async (status) => {
    const { service } = cancellable(status);

    await expect(service.cancelByCustomer('user-1', 'order-1')).rejects.toThrow(/готовится/);
  });

  it('says so plainly when the order is already cancelled', async () => {
    const { service } = cancellable('CANCELLED');

    await expect(service.cancelByCustomer('user-1', 'order-1')).rejects.toThrow(/уже отменён/);
  });

  it('will not cancel an order belonging to someone else', async () => {
    const { service } = createService({ order: null });

    await expect(service.cancelByCustomer('user-1', 'order-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gives the points back and unbooks the promocode', async () => {
    const { service, loyalty, promocodes } = cancellable('CREATED', { promocodeId: 'promo-1' });

    await service.cancelByCustomer('user-1', 'order-1');

    expect(loyalty.refundForCancelledOrder).toHaveBeenCalledWith(expect.anything(), 'user-1', 'order-1');
    expect(promocodes.release).toHaveBeenCalledWith(expect.anything(), 'promo-1', 'order-1');
  });

  it('does not touch promocodes for an order that used none', async () => {
    const { service, promocodes } = cancellable('CREATED', { promocodeId: null });

    await service.cancelByCustomer('user-1', 'order-1');

    expect(promocodes.release).not.toHaveBeenCalled();
  });

  it('loses the race to a kitchen that accepted it a moment earlier', async () => {
    const { service } = createService({
      order: { id: 'order-1', userId: 'user-1', status: 'CREATED' },
      transitionCount: 0,
    });

    await expect(service.cancelByCustomer('user-1', 'order-1')).rejects.toThrow(/готовится/);
  });

  it('persists a cancellation event for both consumers', async () => {
    const { service, prisma } = cancellable('CREATED');
    await service.cancelByCustomer('user-1', 'order-1');
    expect((prisma.eventOutbox as any).createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          destination: 'notifications',
          payload: expect.objectContaining({ status: 'CANCELLED' }),
        }),
        expect.objectContaining({
          destination: 'realtime',
          payload: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      ]),
    });
  });

  it('records the customer as the author of the cancellation', async () => {
    const { service, audit } = cancellable('ACCEPTED');

    await service.cancelByCustomer('user-1', 'order-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_STATUS_CHANGED',
        actorId: 'user-1',
        details: expect.objectContaining({ to: 'CANCELLED', by: 'customer' }),
      }),
    );
  });

  it('asks for the money back', async () => {
    const { service, payments } = cancellable('CREATED');

    await service.cancelByCustomer('user-1', 'order-1');

    expect(payments.refundForCancelledOrder).toHaveBeenCalledWith('order-1');
  });

  /**
   * The order is already off by the time the provider is called. Answering the
   * customer with an error about an order that *is* cancelled would only invite
   * them to press cancel again; the unrefunded payment is left for the
   * `CANCELLED` + `SUCCEEDED` worklist instead.
   */
  it('still reports the cancellation when the refund itself fails', async () => {
    const { service, payments } = cancellable('CREATED');
    payments.refundForCancelledOrder.mockRejectedValue(new Error('provider down'));

    await expect(service.cancelByCustomer('user-1', 'order-1')).resolves.toMatchObject({
      status: 'CANCELLED',
    });
  });
});

/**
 * Cancelling used to mean two different things depending on who did it: the
 * customer's own cancellation returned their points and freed the promocode,
 * and the staff one — the only path that can cancel an order already in the
 * oven — returned nothing at all.
 */
describe('OrderService — a staff cancellation gives back what the order consumed', () => {
  const cancellableByStaff = () =>
    createService({
      order: { id: 'order-1', userId: 'user-1', status: 'CREATED', promocodeId: 'promo-1' },
    });

  it('refunds the loyalty points the order was paid with', async () => {
    const { service, loyalty } = cancellableByStaff();

    await service.updateStatus(asAdmin('order-1', 'CANCELLED'));

    expect(loyalty.refundForCancelledOrder).toHaveBeenCalledWith(expect.anything(), 'user-1', 'order-1');
  });

  it('releases the promocode use the order had booked', async () => {
    const { service, promocodes } = cancellableByStaff();

    await service.updateStatus(asAdmin('order-1', 'CANCELLED'));

    expect(promocodes.release).toHaveBeenCalledWith(expect.anything(), 'promo-1', 'order-1');
  });

  it('refunds the payment', async () => {
    const { service, payments } = cancellableByStaff();

    await service.updateStatus(asAdmin('order-1', 'CANCELLED'));

    expect(payments.refundForCancelledOrder).toHaveBeenCalledWith('order-1');
  });

  it('gives nothing back for a transition that is not a cancellation', async () => {
    const { service, loyalty, promocodes, payments } = cancellableByStaff();

    await service.updateStatus(asAdmin('order-1', 'ACCEPTED'));

    expect(loyalty.refundForCancelledOrder).not.toHaveBeenCalled();
    expect(promocodes.release).not.toHaveBeenCalled();
    expect(payments.refundForCancelledOrder).not.toHaveBeenCalled();
  });
});

describe('staff cannot cook unpaid online orders', () => {
  it('refuses an online order with no payment row', async () => {
    const { service } = createService({
      order: { id: 'order-1', userId: 'user-1', status: 'CREATED', paymentMethod: 'ONLINE' },
    });
    await expect(service.updateStatus(asAdmin('order-1', 'ACCEPTED'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
