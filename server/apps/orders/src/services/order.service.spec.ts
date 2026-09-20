import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';

/**
 * Focused on the order status state machine and access control — the parts
 * where a bug would let a customer see someone else's order or a courier
 * rewind a delivered order.
 */

function createService(overrides: {
  order?: Record<string, unknown> | null;
  /** How many rows the conditional status update matched. 0 = someone else
   *  already moved the order on. */
  transitionCount?: number;
} = {}) {
  const order = overrides.order === undefined ? { id: 'order-1', userId: 'user-1', status: 'CREATED' } : overrides.order;

  let nextStatus = 'CREATED';
  const updateMock = jest.fn(({ data }: { data: { status: string } }) => {
    nextStatus = data.status;
    return { count: overrides.transitionCount ?? 1 };
  });

  const prisma: Record<string, unknown> = {
    order: {
      findUnique: jest.fn(() => order),
      findFirst: jest.fn(() => order),
      updateMany: updateMock,
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(() => ({
        id: 'order-1',
        userId: 'user-1',
        status: nextStatus,
        total: 100000,
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
  };

  const notifications = { emit: jest.fn() };

  const audit = { record: jest.fn(async () => undefined) };

  const service = new OrderService(
    prisma as never,
    { getRawLines: jest.fn(() => []), clear: jest.fn(), replaceLines: jest.fn() } as never,
    { validate: jest.fn(), redeem: jest.fn() } as never,
    loyalty as never,
    audit as never,
    { send: jest.fn() } as never,
    notifications as never,
  );

  return { service, prisma, loyalty, audit, notifications, updateMock };
}

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

    await expect(service.updateStatus('order-1', to as never, 'admin-1')).resolves.toMatchObject({
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

    await expect(service.updateStatus('order-1', to as never, 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an unknown order', async () => {
    const { service } = createService({ order: null });

    await expect(service.updateStatus('missing', 'ACCEPTED' as never, 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('awards loyalty and settles referrals only on DELIVERED', async () => {
    const { service, loyalty } = createService({
      order: { id: 'order-1', userId: 'user-1', status: 'ON_DELIVERY' },
    });

    await service.updateStatus('order-1', 'DELIVERED' as never, 'admin-1');

    expect(loyalty.awardForOrder).toHaveBeenCalledTimes(1);
    expect(loyalty.settleReferral).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });

  it('does not award loyalty on intermediate statuses', async () => {
    const { service, loyalty } = createService({
      order: { id: 'order-1', userId: 'user-1', status: 'ACCEPTED' },
    });

    await service.updateStatus('order-1', 'PREPARING' as never, 'admin-1');

    expect(loyalty.awardForOrder).not.toHaveBeenCalled();
  });

  it('publishes a status-changed event so the customer gets notified', async () => {
    const { service, notifications } = createService({
      order: { id: 'order-1', userId: 'user-1', status: 'CREATED' },
    });

    await service.updateStatus('order-1', 'ACCEPTED' as never, 'admin-1');

    expect(notifications.emit).toHaveBeenCalledWith(
      'order.status.changed',
      expect.objectContaining({ orderId: 'order-1', userId: 'user-1', status: 'ACCEPTED' }),
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
    const { service } = createService({ order: { id: 'order-1', userId: 'someone-else', status: 'CREATED' } });

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
    const { service } = createService({ order: { id: 'order-1', userId: 'someone-else', status: 'CREATED' } });

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
