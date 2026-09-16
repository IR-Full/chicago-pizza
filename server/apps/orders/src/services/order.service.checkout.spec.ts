import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { OrderService } from './order.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma and transport mocks */

/**
 * Checkout is where money, stock of promocodes and loyalty points all meet.
 * The prices used here always come back from the products service — the test
 * doubles never let the cart decide what something costs.
 */
function createService(overrides: { subtotal?: number; lines?: any[] } = {}) {
  const subtotal = overrides.subtotal ?? 50_000;
  const lines = overrides.lines ?? [{ lineId: 'l1', config: { productId: 'p1', sizeCm: 45 }, quantity: 1 }];

  const createdOrder = { id: 'order-1', userId: 'user-1', total: 0, items: [], address: {} };

  const prisma: Record<string, any> = {
    address: { findFirst: jest.fn(async () => ({ id: 'addr-1', userId: 'user-1' })) },
    order: {
      create: jest.fn(async ({ data }: any) => ({ ...createdOrder, total: data.total })),
      findUnique: jest.fn(async () => ({ id: 'order-1', userId: 'user-1', status: 'CREATED', items: [] })),
      findFirst: jest.fn(async () => ({ id: 'order-1', userId: 'user-1', status: 'DELIVERED', items: [] })),
      findMany: jest.fn(async () => [{ id: 'order-1' }]),
      count: jest.fn(async () => 1),
    },
    promocode: { update: jest.fn(async () => ({})) },
    review: { upsert: jest.fn(async () => ({ id: 'review-1' })) },
  };
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));

  const cart: Record<string, any> = {
    getRawLines: jest.fn(async () => lines),
    clear: jest.fn(async () => undefined),
    replaceLines: jest.fn(async (_userId: string, _lines: any[]) => ({ lines: [], subtotal: 0, itemCount: 0 })),
  };
  const promocodes = { validate: jest.fn(async () => ({ promocodeId: 'promo-1', code: 'CHICAGO10', discount: 5_000 })) };
  const loyalty = { redeemPoints: jest.fn(async () => 0), awardForOrder: jest.fn(), settleReferral: jest.fn() };

  const products = {
    send: jest.fn(() =>
      of({
        items: lines.map((line: any, index: number) => ({
          productId: line.config.productId,
          productName: `Товар ${index + 1}`,
          sizeLabel: '45 см',
          doughTypeId: null,
          quantity: line.quantity,
          unitPrice: subtotal / lines.length,
          totalPrice: subtotal / lines.length,
        })),
        subtotal,
      }),
    ),
  };
  const notifications = { emit: jest.fn() };

  const service = new OrderService(
    prisma as never,
    cart as never,
    promocodes as never,
    loyalty as never,
    products as never,
    notifications as never,
  );

  return { service, prisma, cart, promocodes, loyalty, products, notifications };
}

const DTO = { addressId: 'addr-1', deliveryType: 'ASAP', paymentMethod: 'CASH_ON_DELIVERY' } as never;

const orderDataOf = (prisma: Record<string, any>) => prisma.order.create.mock.calls[0][0].data;

describe('OrderService — checkout guards', () => {
  it('refuses an empty cart', async () => {
    const { service, prisma } = createService({ lines: [] });

    await expect(service.checkout('user-1', DTO)).rejects.toThrow(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('refuses an address that does not belong to the customer', async () => {
    const { service, prisma } = createService();
    prisma.address.findFirst.mockResolvedValue(null);

    await expect(service.checkout('user-1', DTO)).rejects.toThrow(NotFoundException);
  });

  it('scopes the address lookup to the caller', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', DTO);

    expect(prisma.address.findFirst).toHaveBeenCalledWith({ where: { id: 'addr-1', userId: 'user-1' } });
  });

  it('rejects a scheduled slot less than half an hour away', async () => {
    const { service } = createService();
    const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await expect(
      service.checkout('user-1', { ...(DTO as object), deliveryType: 'SCHEDULED', scheduledAt: soon } as never),
    ).rejects.toThrow(/минимум через 30 минут/);
  });

  it('rejects an unparseable scheduled time', async () => {
    const { service } = createService();

    await expect(
      service.checkout('user-1', {
        ...(DTO as object),
        deliveryType: 'SCHEDULED',
        scheduledAt: 'завтра',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a slot far enough ahead and stores it', async () => {
    const { service, prisma } = createService();
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    await service.checkout('user-1', {
      ...(DTO as object),
      deliveryType: 'SCHEDULED',
      scheduledAt: later,
    } as never);

    expect(orderDataOf(prisma).scheduledAt).toEqual(new Date(later));
  });

  it('stores no scheduled time for an ASAP order', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', DTO);

    expect(orderDataOf(prisma).scheduledAt).toBeNull();
  });
});

describe('OrderService — checkout totals', () => {
  it('re-prices the cart server-side instead of trusting it', async () => {
    const { service, products } = createService();

    await service.checkout('user-1', DTO);

    expect(products.send).toHaveBeenCalledWith('products.validate_order_items', {
      items: [{ config: { productId: 'p1', sizeCm: 45 }, quantity: 1 }],
    });
  });

  it('charges delivery below the free threshold', async () => {
    const { service, prisma } = createService({ subtotal: 99_999 });

    await service.checkout('user-1', DTO);

    expect(orderDataOf(prisma)).toMatchObject({ deliveryFee: 15_000, total: 99_999 + 15_000 });
  });

  it('delivers free at exactly the threshold', async () => {
    const { service, prisma } = createService({ subtotal: 100_000 });

    await service.checkout('user-1', DTO);

    expect(orderDataOf(prisma)).toMatchObject({ deliveryFee: 0, total: 100_000 });
  });

  it('applies a promocode discount and books the usage', async () => {
    const { service, prisma } = createService({ subtotal: 50_000 });

    await service.checkout('user-1', { ...(DTO as object), promocode: 'chicago10' } as never);

    expect(orderDataOf(prisma)).toMatchObject({ discount: 5_000, promocodeId: 'promo-1', total: 60_000 });
    expect(prisma.promocode.update).toHaveBeenCalledWith({
      where: { id: 'promo-1' },
      data: { usedCount: { increment: 1 } },
    });
  });

  it('does not touch promocode usage when none was supplied', async () => {
    const { service, prisma, promocodes } = createService();

    await service.checkout('user-1', DTO);

    expect(promocodes.validate).not.toHaveBeenCalled();
    expect(prisma.promocode.update).not.toHaveBeenCalled();
    expect(orderDataOf(prisma).promocodeId).toBeNull();
  });

  it('redeems points against the already-discounted subtotal', async () => {
    const { service, loyalty } = createService({ subtotal: 50_000 });
    loyalty.redeemPoints.mockResolvedValue(10_000 as never);

    await service.checkout('user-1', { ...(DTO as object), promocode: 'CHICAGO10', redeemPoints: 200 } as never);

    // 50 000 − 5 000 promo = 45 000 is the cap the points may eat into.
    expect(loyalty.redeemPoints).toHaveBeenCalledWith(expect.anything(), 'user-1', 200, 45_000);
  });

  it('sums both discounts into the order', async () => {
    const { service, prisma, loyalty } = createService({ subtotal: 50_000 });
    loyalty.redeemPoints.mockResolvedValue(10_000 as never);

    await service.checkout('user-1', { ...(DTO as object), promocode: 'CHICAGO10', redeemPoints: 200 } as never);

    expect(orderDataOf(prisma)).toMatchObject({ discount: 15_000, total: 50_000 - 15_000 + 15_000 });
  });

  it('never lets discounts drive the goods total below zero', async () => {
    const { service, prisma, loyalty } = createService({ subtotal: 10_000 });
    loyalty.redeemPoints.mockResolvedValue(50_000 as never);

    await service.checkout('user-1', { ...(DTO as object), redeemPoints: 500 } as never);

    // Only the delivery fee is left to pay.
    expect(orderDataOf(prisma).total).toBe(15_000);
  });

  it('skips the loyalty call when no points are spent', async () => {
    const { service, loyalty } = createService();

    await service.checkout('user-1', DTO);

    expect(loyalty.redeemPoints).not.toHaveBeenCalled();
  });
});

describe('OrderService — checkout persistence', () => {
  it('writes the priced lines and their original configuration', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', DTO);

    expect(orderDataOf(prisma).items.create).toEqual([
      expect.objectContaining({
        productId: 'p1',
        productName: 'Товар 1',
        quantity: 1,
        config: { productId: 'p1', sizeCm: 45 },
      }),
    ]);
  });

  it('opens the status history at CREATED', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', DTO);

    expect(orderDataOf(prisma).statusHistory.create).toEqual({ status: 'CREATED', changedById: 'user-1' });
  });

  it('runs the whole checkout in one transaction', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', DTO);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('empties the cart and announces the order', async () => {
    const { service, cart, notifications } = createService({ subtotal: 50_000 });

    await service.checkout('user-1', DTO);

    expect(cart.clear).toHaveBeenCalledWith('user-1');
    expect(notifications.emit).toHaveBeenCalledWith('order.created', {
      orderId: 'order-1',
      userId: 'user-1',
      total: 65_000,
    });
  });

  it('returns the freshly read order', async () => {
    const { service, prisma } = createService();

    await expect(service.checkout('user-1', DTO)).resolves.toMatchObject({ id: 'order-1' });
    expect(prisma.order.findUnique).toHaveBeenCalled();
  });
});

describe('OrderService — listOrders', () => {
  it('returns the customer’s own orders newest first', async () => {
    const { service, prisma } = createService();

    await service.listOrders('user-1');

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' }, orderBy: { createdAt: 'desc' }, skip: 0, take: 20 }),
    );
  });

  it('paginates', async () => {
    const { service, prisma } = createService();
    prisma.order.count.mockResolvedValue(45);

    await expect(service.listOrders('user-1', 2, 10)).resolves.toMatchObject({
      total: 45,
      page: 2,
      limit: 10,
      totalPages: 5,
    });
    expect(prisma.order.findMany.mock.calls[0][0].skip).toBe(10);
  });
});

describe('OrderService — getOrder access control', () => {
  it('returns the order to its owner', async () => {
    const { service } = createService();

    await expect(service.getOrder('user-1', 'order-1', 'USER' as never)).resolves.toMatchObject({ id: 'order-1' });
  });

  it('404s for an unknown order', async () => {
    const { service, prisma } = createService();
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(service.getOrder('user-1', 'ghost', 'USER' as never)).rejects.toThrow(NotFoundException);
  });

  it('refuses another customer’s order', async () => {
    const { service } = createService();

    await expect(service.getOrder('user-2', 'order-1', 'USER' as never)).rejects.toThrow(ForbiddenException);
  });

  it.each([['ADMIN'], ['COURIER'], ['SUPPORT']])('lets %s read any order', async (role) => {
    const { service } = createService();

    await expect(service.getOrder('staff-1', 'order-1', role as never)).resolves.toMatchObject({ id: 'order-1' });
  });
});

describe('OrderService — repeatOrder', () => {
  it('404s when the order is not the caller’s', async () => {
    const { service, prisma } = createService();
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(service.repeatOrder('user-1', 'order-1')).rejects.toThrow(NotFoundException);
  });

  it('refills the cart from the stored configurations', async () => {
    const { service, prisma, cart } = createService();
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      items: [
        { id: 'item-1', config: { productId: 'p1', sizeCm: 45 }, quantity: 2 },
        { id: 'item-2', config: { productId: 'p2' }, quantity: 1 },
      ],
    });

    await service.repeatOrder('user-1', 'order-1');

    expect(cart.replaceLines).toHaveBeenCalledWith('user-1', [
      { lineId: 'item-1', config: { productId: 'p1', sizeCm: 45 }, quantity: 2 },
      { lineId: 'item-2', config: { productId: 'p2' }, quantity: 1 },
    ]);
  });

  it('skips items whose configuration was never stored', async () => {
    const { service, prisma, cart } = createService();
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      items: [
        { id: 'item-1', config: null, quantity: 1 },
        { id: 'item-2', config: { productId: 'p2' }, quantity: 1 },
      ],
    });

    await service.repeatOrder('user-1', 'order-1');

    expect(cart.replaceLines.mock.calls[0][1]).toHaveLength(1);
  });

  it('explains when nothing can be repeated', async () => {
    const { service, prisma } = createService();
    prisma.order.findFirst.mockResolvedValue({ id: 'order-1', userId: 'user-1', items: [{ id: 'i', config: null, quantity: 1 }] });

    await expect(service.repeatOrder('user-1', 'order-1')).rejects.toThrow(/Нечего повторить/);
  });
});

describe('OrderService — submitReview', () => {
  it.each([[0], [6], [-1]])('rejects a rating of %i', async (rating) => {
    const { service } = createService();

    await expect(service.submitReview('user-1', 'order-1', rating)).rejects.toThrow(/от 1 до 5/);
  });

  it('404s for an order the caller does not own', async () => {
    const { service, prisma } = createService();
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(service.submitReview('user-1', 'order-1', 5)).rejects.toThrow(NotFoundException);
  });

  it('refuses to rate an order that has not arrived', async () => {
    const { service, prisma } = createService();
    prisma.order.findFirst.mockResolvedValue({ id: 'order-1', userId: 'user-1', status: 'ON_DELIVERY' });

    await expect(service.submitReview('user-1', 'order-1', 5)).rejects.toThrow(/только доставленный/);
  });

  it('upserts so a customer can revise their rating', async () => {
    const { service, prisma } = createService();

    await service.submitReview('user-1', 'order-1', 4, 'Тесто отличное');

    expect(prisma.review.upsert).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      update: { rating: 4, comment: 'Тесто отличное' },
      create: { orderId: 'order-1', userId: 'user-1', rating: 4, comment: 'Тесто отличное' },
    });
  });
});

describe('OrderService — adminListOrders', () => {
  it('lists every order with its customer', async () => {
    const { service, prisma } = createService();

    await service.adminListOrders({ page: 1, limit: 20 });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: { createdAt: 'desc' }, skip: 0, take: 20 }),
    );
    expect(prisma.order.findMany.mock.calls[0][0].include.user.select).toMatchObject({ phone: true, email: true });
  });

  it('filters by status when the kitchen asks for one', async () => {
    const { service, prisma } = createService();

    await service.adminListOrders({ page: 1, limit: 20, status: 'PREPARING' as never });

    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({ status: 'PREPARING' });
  });

  it('reports the page count', async () => {
    const { service, prisma } = createService();
    prisma.order.count.mockResolvedValue(31);

    await expect(service.adminListOrders({ page: 2, limit: 10 })).resolves.toMatchObject({ totalPages: 4, page: 2 });
  });
});
