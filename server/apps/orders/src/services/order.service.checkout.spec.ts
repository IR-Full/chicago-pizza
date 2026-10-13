import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { OrderService } from './order.service';

/**
 * An in-memory stand-in for Redis — enough of `SET NX` / `GET` / `DEL` to
 * exercise idempotency for real, rather than asserting that a mock was
 * called.
 */
function fakeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    setIfAbsent: jest.fn(async (key: string, value: unknown) => {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: jest.fn(async (...keys: string[]) => {
      for (const key of keys) store.delete(key);
    }),
  };
}

/**
 * Checkout is where money, stock of promocodes and loyalty points all meet.
 * The prices used here always come back from the products service — the test
 * doubles never let the cart decide what something costs.
 */
function createService(overrides: { subtotal?: number; lines?: any[]; pricingSkips?: number[] } = {}) {
  const subtotal = overrides.subtotal ?? 50_000;
  const lines = overrides.lines ?? [{ lineId: 'l1', config: { productId: 'p1', sizeCm: 45 }, quantity: 1 }];

  const createdOrder = { id: 'order-1', userId: 'user-1', total: 0, items: [], address: {} };

  const committed = new Map<string, any>();

  const unavailable: { index: number; productId: string; reason: string }[] = [];

  const prisma: Record<string, any> = {
    address: {
      // Coordinates present: an address with a map pin is the only kind a
      // zone can be tested against.
      findFirst: jest.fn(async () => ({ id: 'addr-1', userId: 'user-1', lat: 42.98, lng: 47.5 })),
    },
    user: { findUniqueOrThrow: jest.fn(async () => ({ isEmailVerified: true })) },
    eventOutbox: { createMany: jest.fn(async () => ({ count: 2 })) },
    $queryRaw: jest.fn(async () => []),
    order: {
      create: jest.fn(async ({ data }: any) => {
        const result = { ...createdOrder, ...data };
        if (data.idempotencyKey) committed.set(data.userId + ':' + data.idempotencyKey, result);
        return result;
      }),
      findUnique: jest.fn(async () => ({ id: 'order-1', userId: 'user-1', status: 'CREATED', items: [] })),
      findFirst: jest.fn(async ({ where }: any) =>
        where.idempotencyKey
          ? (committed.get(where.userId + ':' + where.idempotencyKey) ?? null)
          : { id: 'order-1', userId: 'user-1', status: 'DELIVERED', items: [] },
      ),
      findMany: jest.fn(async () => [{ id: 'order-1' }]),
      count: jest.fn(async () => 1),
    },
    promocode: { update: jest.fn(async () => ({})) },
    // The points ledger row is written before the order exists, then linked
    // to it once it has an id.
    loyaltyTransaction: { update: jest.fn(async () => ({})) },
    review: {
      upsert: jest.fn(async () => ({ id: 'review-1' })),
      findMany: jest.fn(async () => [
        {
          id: 'review-1',
          rating: 5,
          comment: 'Приехало горячим, хватило на всех',
          createdAt: new Date('2026-09-01T10:00:00.000Z'),
          user: { firstName: 'Амина' },
          order: { items: [{ productName: 'Пепперони' }, { productName: 'Кола' }] },
        },
      ]),
    },
  };
  let previous = Promise.resolve();
  prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => {
    const run = previous.then(() => cb(prisma));
    previous = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  });

  const cart: Record<string, any> = {
    getRawLines: jest.fn(async () => lines),
    clear: jest.fn(async () => undefined),
    replaceLines: jest.fn(async (_userId: string, _lines: any[]) => ({
      lines: [],
      subtotal: 0,
      itemCount: 0,
    })),
  };
  const promocodes = {
    validate: jest.fn(async () => ({ promocodeId: 'promo-1', code: 'CHICAGO10', discount: 5_000 })),
    redeem: jest.fn(async () => undefined),
  };
  const loyalty = {
    redeemPoints: jest.fn(async () => ({ discount: 0, transactionId: null })),
    awardForOrder: jest.fn(),
    settleReferral: jest.fn(),
    refundForCancelledOrder: jest.fn(async () => 0),
  };

  /** The branch a delivery is assigned to, and a collection is validated against. */
  const branch = {
    id: 'branch-1',
    name: 'Chicago Pizza на Нурадилова',
    // Minutes from midnight: 11:30 — 23:30, the hours every branch but one
    // keeps.
    openMinute: 11 * 60 + 30,
    closeMinute: 23 * 60 + 30,
  };

  /** By default the shop has drawn no zones, so the flat tariff applies. */
  const zoneLookup: { configured: boolean; zone: Record<string, unknown> | null } = {
    configured: false,
    zone: null,
  };

  /**
   * Faithful stand-in for `PricingService.priceItems`: unavailable lines are
   * *removed* from `items`, and every priced line carries the index of the
   * request line it came from. A fake that returned one priced item per
   * request line no matter what could never have caught checkout storing a
   * neighbour's configuration on an order.
   */
  const priceLines = () => {
    // `pricingSkips` leaves lines out *without* reporting them, which is what
    // a future change to `priceItems` would look like from here.
    const dropped = new Set([...unavailable.map((u) => u.index), ...(overrides.pricingSkips ?? [])]);
    const items = lines
      .map((line: any, index: number) => ({ line, index }))
      .filter(({ index }: any) => !dropped.has(index))
      .map(({ line, index }: any) => ({
        index,
        productId: line.config.productId,
        productName: `Товар ${index + 1}`,
        sizeLabel: '45 см',
        doughTypeId: null,
        quantity: line.quantity,
        unitPrice: subtotal / lines.length,
        totalPrice: subtotal / lines.length,
      }));

    return { items, subtotal, unavailable };
  };

  /**
   * What the products service answers when asked for a kitchen. Mutable and
   * nullable: `DEFAULT_DELIVERY_BRANCH` really can answer null — no branch is
   * active — and checkout has to refuse rather than write an order nobody can
   * make.
   */
  let orderableBranch: typeof branch | null = branch;

  const products = {
    send: jest.fn((pattern: string) =>
      pattern === 'products.resolve_delivery_zone'
        ? of(zoneLookup)
        : pattern === 'products.default_delivery_branch' || pattern === 'products.get_orderable_branch'
          ? of(orderableBranch)
          : of(priceLines()),
    ),
  };
  const notifications = { emit: jest.fn() };
  const realtime = { emit: jest.fn() };

  const audit = { record: jest.fn(async () => undefined) };
  const cache = fakeCache();
  /** Online payment is off unless a test switches it on. */
  const payments = { isEnabled: false };

  const service = new OrderService(
    prisma as never,
    cart as never,
    promocodes as never,
    loyalty as never,
    audit as never,
    cache as never,
    payments as never,
    products as never,
    notifications as never,
    realtime as never,
  );

  return {
    service,
    prisma,
    cart,
    promocodes,
    loyalty,
    products,
    payments,
    branch,
    zoneLookup,
    notifications,
    realtime,
    cache,
    /** Makes the products service report line `index` as no longer orderable. */
    markUnavailable: (index: number, productId = 'p1') =>
      unavailable.push({ index, productId, reason: 'Товар недоступен' }),
    /** Leaves the shop with no kitchen able to take the order. */
    withoutBranch: () => {
      orderableBranch = null;
    },
  };
}

describe('OrderService — what ends up on the order', () => {
  const LINES = [
    { lineId: 'l1', config: { productId: 'p1', sizeCm: 30, doughTypeId: 'thin' }, quantity: 1 },
    { lineId: 'l2', config: { productId: 'p2', sizeCm: 45, doughTypeId: 'cheesy' }, quantity: 2 },
    { lineId: 'l3', config: { productId: 'p3', sizeCm: 30 }, quantity: 1 },
  ];

  const checkoutDto = {
    fulfillment: 'PICKUP',
    branchId: 'branch-1',
    deliveryType: 'ASAP',
    paymentMethod: 'CASH_ON_DELIVERY',
  } as any;

  it('stores each line with the configuration the customer built', async () => {
    const { service, prisma } = createService({ lines: LINES });

    await service.checkout('user-1', checkoutDto);

    const created = prisma.order.create.mock.calls[0][0].data.items.create;
    expect(created.map((item: any) => item.config)).toEqual(LINES.map((line) => line.config));
  });

  /**
   * The alignment between priced items and cart lines used to be positional,
   * held up only by the refusal twenty lines above it — and `priceItems`
   * *removes* the lines it cannot price. The day that refusal is loosened, or
   * pricing drops a line for a reason it does not report, every following
   * line would silently be stored with its neighbour's toppings: a customer
   * charged for one pizza and sent another.
   */
  it('never carries a neighbouring configuration onto a line when pricing skips one', async () => {
    const { service, prisma } = createService({ lines: LINES, pricingSkips: [0] });

    await service.checkout('user-1', checkoutDto);

    const created = prisma.order.create.mock.calls[0][0].data.items.create;
    expect(created).toHaveLength(2);
    expect(created.map((item: any) => item.config)).toEqual([LINES[1].config, LINES[2].config]);
    expect(created.map((item: any) => item.productId)).toEqual(['p2', 'p3']);
  });

  it('refuses rather than guessing when pricing names a line that is not there', async () => {
    const { service, products } = createService({ lines: LINES });
    products.send.mockImplementation(((pattern: string) =>
      pattern === 'products.validate_order_items'
        ? of({
            items: [
              { index: 7, productId: 'p9', productName: '?', quantity: 1, unitPrice: 1, totalPrice: 1 },
            ],
            subtotal: 1,
            unavailable: [],
          })
        : of({
            id: 'branch-1',
            name: 'Chicago Pizza',
            openMinute: 11 * 60 + 30,
            closeMinute: 23 * 60 + 30,
          })) as never);

    await expect(service.checkout('user-1', checkoutDto)).rejects.toBeInstanceOf(BadRequestException);
  });
});

/** A slot inside opening hours, far enough ahead to be accepted. */
function tomorrowAt(hour: number): string {
  const when = new Date();
  when.setDate(when.getDate() + 1);
  when.setHours(hour, 30, 0, 0);
  return when.toISOString();
}

const DTO = { addressId: 'addr-1', deliveryType: 'ASAP', paymentMethod: 'CASH_ON_DELIVERY' } as never;

/**
 * The clock, pinned to an afternoon the shop is open.
 *
 * An ASAP order is now checked against opening hours too — it is one the
 * kitchen starts on immediately, so "now" has to be inside them. Left on the
 * wall clock this suite would pass all afternoon and fail every evening, which
 * is the worst kind of test: the one that is green when you write it.
 *
 * Only `Date` is faked. The timers stay real because faking them would stall
 * any promise the code under test awaits on one.
 */
beforeAll(() => {
  jest.useFakeTimers({
    // 12:00 UTC — mid-afternoon in Makhachkala, comfortably inside 11:30–23:30.
    now: new Date('2026-09-01T12:00:00.000Z'),
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'performance',
    ],
  });
});

afterAll(() => {
  jest.useRealTimers();
});

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
      service.checkout('user-1', {
        ...(DTO as object),
        deliveryType: 'SCHEDULED',
        scheduledAt: soon,
      } as never),
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
    const later = tomorrowAt(18);

    await service.checkout('user-1', {
      ...(DTO as object),
      deliveryType: 'SCHEDULED',
      scheduledAt: later,
    } as never);

    expect(orderDataOf(prisma).scheduledAt).toEqual(new Date(later));
  });

  // 04:30 and 09:30 are before opening; 23:30 is the closing minute itself,
  // which is excluded — the last order goes in before it, not at it.
  it.each([[4], [9], [23]])('refuses %i:30 — the pizzeria is closed', async (hour) => {
    const { service } = createService();

    await expect(
      service.checkout('user-1', {
        ...(DTO as object),
        deliveryType: 'SCHEDULED',
        scheduledAt: tomorrowAt(hour),
      } as never),
    ).rejects.toThrow(/работает с 11:30 до 23:30/);
  });

  // 11:30 is the opening minute and is included.
  it.each([[11], [15], [22]])('accepts %i:30, inside opening hours', async (hour) => {
    const { service } = createService();

    await expect(
      service.checkout('user-1', {
        ...(DTO as object),
        deliveryType: 'SCHEDULED',
        scheduledAt: tomorrowAt(hour),
      } as never),
    ).resolves.toBeDefined();
  });

  it('stores no scheduled time for an ASAP order', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', DTO);

    expect(orderDataOf(prisma).scheduledAt).toBeNull();
  });
});

/**
 * Opening hours used to be a scheduling concern only, so "as soon as possible"
 * — the default, and what almost every order is — skipped the check entirely.
 * The form took an order at four in the morning and the kitchen found out in
 * the morning.
 */
describe('OrderService — an ASAP order needs an open kitchen', () => {
  it('takes an ASAP order while the branch is open', async () => {
    const { service } = createService();

    await expect(service.checkout('user-1', DTO)).resolves.toBeDefined();
  });

  it('refuses an ASAP order after the branch has closed', async () => {
    const { service, branch } = createService();
    // Closed an hour before the frozen clock reads 15:00 in Makhachkala.
    branch.closeMinute = 14 * 60;

    await expect(service.checkout('user-1', DTO)).rejects.toThrow(/работает с 11:30 до 14:00/);
  });

  it('refuses an ASAP order before the branch opens', async () => {
    const { service, branch } = createService();
    branch.openMinute = 18 * 60;

    await expect(service.checkout('user-1', DTO)).rejects.toThrow(/работает с 18:00/);
  });

  it('takes an ASAP order at a branch that works through the night', async () => {
    const { service, branch } = createService();
    // 11:30 → 06:00 wraps midnight; 15:00 is inside it.
    branch.closeMinute = 6 * 60;

    await expect(service.checkout('user-1', DTO)).resolves.toBeDefined();
  });

  it('writes no order when the kitchen is shut', async () => {
    const { service, branch, prisma } = createService();
    branch.closeMinute = 14 * 60;

    await expect(service.checkout('user-1', DTO)).rejects.toThrow();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});

/**
 * `DEFAULT_DELIVERY_BRANCH` answers null when no branch is active. The order
 * was then written with `branchId: null` — unmakeable, and invisible to the
 * kitchen board, which filters by branch.
 */
describe('OrderService — an order with no kitchen behind it', () => {
  it('refuses a delivery when no branch can take it', async () => {
    const { service, withoutBranch } = createService();
    withoutBranch();

    await expect(service.checkout('user-1', DTO)).rejects.toThrow(/нет открытой пиццерии/);
  });

  it('writes no order rather than one nobody can cook', async () => {
    const { service, withoutBranch, prisma } = createService();
    withoutBranch();

    await expect(service.checkout('user-1', DTO)).rejects.toThrow();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('always stores the branch that will make the order', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', DTO);

    expect(orderDataOf(prisma).branchId).toBe('branch-1');
  });
});

describe('OrderService — checkout availability', () => {
  it('refuses to charge for a basket that changed under the customer', async () => {
    const { service, prisma, markUnavailable } = createService();
    markUnavailable(0, 'p1');

    await expect(service.checkout('user-1', DTO)).rejects.toThrow(/больше недоступны/);
    expect(prisma.order.create).not.toHaveBeenCalled();
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
    const { service, prisma, promocodes } = createService({ subtotal: 50_000 });

    await service.checkout('user-1', { ...(DTO as object), promocode: 'chicago10' } as never);

    // The customer is passed along so the per-account limit can be checked.
    expect(promocodes.validate).toHaveBeenCalledWith('chicago10', 50_000, 'user-1');

    expect(orderDataOf(prisma)).toMatchObject({ discount: 5_000, promocodeId: 'promo-1', total: 60_000 });
    // Booking it goes through the service, which increments conditionally and
    // records the redemption against this customer.
    expect(promocodes.redeem).toHaveBeenCalledWith(expect.anything(), 'promo-1', 'user-1', 'order-1');
  });

  it('does not touch promocode usage when none was supplied', async () => {
    const { service, prisma, promocodes } = createService();

    await service.checkout('user-1', DTO);

    expect(promocodes.validate).not.toHaveBeenCalled();
    expect(promocodes.redeem).not.toHaveBeenCalled();
    expect(orderDataOf(prisma).promocodeId).toBeNull();
  });

  it('redeems points against the already-discounted subtotal', async () => {
    const { service, loyalty } = createService({ subtotal: 50_000 });
    loyalty.redeemPoints.mockResolvedValue({ discount: 10_000, transactionId: 'tx-1' } as never);

    await service.checkout('user-1', {
      ...(DTO as object),
      promocode: 'CHICAGO10',
      redeemPoints: 200,
    } as never);

    // 50 000 − 5 000 promo = 45 000 is the cap the points may eat into.
    expect(loyalty.redeemPoints).toHaveBeenCalledWith(expect.anything(), 'user-1', 200, 45_000);
  });

  it('sums both discounts into the order', async () => {
    const { service, prisma, loyalty } = createService({ subtotal: 50_000 });
    loyalty.redeemPoints.mockResolvedValue({ discount: 10_000, transactionId: 'tx-1' } as never);

    await service.checkout('user-1', {
      ...(DTO as object),
      promocode: 'CHICAGO10',
      redeemPoints: 200,
    } as never);

    expect(orderDataOf(prisma)).toMatchObject({ discount: 15_000, total: 50_000 - 15_000 + 15_000 });
  });

  it('never lets discounts drive the goods total below zero', async () => {
    const { service, prisma, loyalty } = createService({ subtotal: 10_000 });
    loyalty.redeemPoints.mockResolvedValue({ discount: 50_000, transactionId: 'tx-1' } as never);

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

  it('empties the cart and stores the event in the checkout transaction', async () => {
    const { service, cart, prisma } = createService({ subtotal: 50_000 });
    await service.checkout('user-1', DTO);
    expect(cart.clear).toHaveBeenCalledWith('user-1');
    expect(prisma.eventOutbox.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          destination: 'notifications',
          event: 'order.created',
          payload: { orderId: 'order-1', userId: 'user-1', total: 65_000 },
        }),
        expect.objectContaining({ destination: 'realtime', event: 'order.created' }),
      ]),
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
      expect.objectContaining({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      }),
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

    await expect(service.getOrder('user-1', 'order-1', 'USER' as never)).resolves.toMatchObject({
      id: 'order-1',
    });
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

  it.each([['ADMIN'], ['SUPPORT']])('lets %s read any order', async (role) => {
    const { service } = createService();

    await expect(service.getOrder('staff-1', 'order-1', role as never)).resolves.toMatchObject({
      id: 'order-1',
    });
  });

  it('lets a courier read a live order, but not a finished one', async () => {
    const { service } = createService();

    // An unclaimed order still waiting for a courier is theirs to take; a
    // delivered one is a customer record with an address attached.
    await expect(service.getOrder('courier-1', 'order-1', 'COURIER' as never)).resolves.toMatchObject({
      id: 'order-1',
    });
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

  it('drops items whose product has since been delisted', async () => {
    const { service, prisma, cart, markUnavailable } = createService();
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      items: [
        { id: 'item-1', config: { productId: 'gone' }, quantity: 1 },
        { id: 'item-2', config: { productId: 'p2' }, quantity: 1 },
      ],
    });
    markUnavailable(0, 'gone');

    await service.repeatOrder('user-1', 'order-1');

    // Putting a delisted product back used to poison the cart: every read of
    // it then failed on that product.
    expect(cart.replaceLines).toHaveBeenCalledWith('user-1', [
      { lineId: 'item-2', config: { productId: 'p2' }, quantity: 1 },
    ]);
  });

  it('explains when nothing from the order can be ordered again', async () => {
    const { service, prisma, markUnavailable } = createService();
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      items: [{ id: 'item-1', config: { productId: 'gone' }, quantity: 1 }],
    });
    markUnavailable(0, 'gone');

    await expect(service.repeatOrder('user-1', 'order-1')).rejects.toThrow(/товары больше не доступны/);
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
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      items: [{ id: 'i', config: null, quantity: 1 }],
    });

    await expect(service.repeatOrder('user-1', 'order-1')).rejects.toThrow(/состав заказа не сохранён/);
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

describe('OrderService — recent reviews', () => {
  it('quotes only reviews that say something and rate the order well', async () => {
    const { service, prisma } = createService();

    await service.listRecentReviews();

    expect(prisma.review.findMany.mock.calls[0][0]).toMatchObject({
      where: { comment: { not: null }, rating: { gte: 4 } },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
  });

  it('returns the author and what the order contained', async () => {
    const { service } = createService();

    // A review rates the order, so it is shown with that order's items rather
    // than pinned to a single product.
    await expect(service.listRecentReviews()).resolves.toEqual([
      {
        id: 'review-1',
        rating: 5,
        comment: 'Приехало горячим, хватило на всех',
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
        authorName: 'Амина',
        items: ['Пепперони', 'Кола'],
      },
    ]);
  });

  it('clamps the requested limit', async () => {
    const { service, prisma } = createService();

    await service.listRecentReviews(500);
    await service.listRecentReviews(0);

    expect(prisma.review.findMany.mock.calls[0][0].take).toBe(20);
    expect(prisma.review.findMany.mock.calls[1][0].take).toBe(1);
  });
});

describe('OrderService — adminListOrders', () => {
  it('lists every order with its customer', async () => {
    const { service, prisma } = createService();

    await service.adminListOrders({ page: 1, limit: 20, actorId: 'admin-1', actorRole: 'ADMIN' as never });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: { createdAt: 'desc' }, skip: 0, take: 20 }),
    );
    expect(prisma.order.findMany.mock.calls[0][0].include.user.select).toMatchObject({
      phone: true,
      email: true,
    });
  });

  it('filters by status when the kitchen asks for one', async () => {
    const { service, prisma } = createService();

    await service.adminListOrders({
      page: 1,
      limit: 20,
      status: 'PREPARING' as never,
      actorId: 'admin-1',
      actorRole: 'ADMIN' as never,
    });

    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({ status: 'PREPARING' });
  });

  it('reports the page count', async () => {
    const { service, prisma } = createService();
    prisma.order.count.mockResolvedValue(31);

    await expect(
      service.adminListOrders({ page: 2, limit: 10, actorId: 'admin-1', actorRole: 'ADMIN' as never }),
    ).resolves.toMatchObject({ totalPages: 4, page: 2 });
  });
});

/**
 * A checkout that can run twice charges twice. The button being disabled is a
 * UI courtesy, not a guarantee: a double tap on a slow connection, a retry
 * after a timeout or a back-forward replay all reach the server again.
 */
describe('OrderService — checkout idempotency', () => {
  const KEY = 'attempt-0001';

  it('creates one order for a resubmitted key, and returns the first one', async () => {
    const { service, prisma } = createService();

    const first = await service.checkout('user-1', DTO, KEY);
    const second = await service.checkout('user-1', DTO, KEY);

    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ id: (first as { id: string }).id });
  });

  it('does not spend the promocode or the points a second time', async () => {
    const { service, promocodes, loyalty } = createService();

    const paying = { ...(DTO as object), promocode: 'CHICAGO10', redeemPoints: 100 } as never;

    await service.checkout('user-1', paying, KEY);
    await service.checkout('user-1', paying, KEY);

    expect(promocodes.redeem).toHaveBeenCalledTimes(1);
    expect(loyalty.redeemPoints).toHaveBeenCalledTimes(1);
  });

  it('does not depend on an evicted or stale Redis idempotency entry', async () => {
    const { service, cache, prisma } = createService();
    cache.store.set('order:idem:user-1:attempt-0001', { state: 'pending' });
    await service.checkout('user-1', DTO, KEY);
    cache.store.clear();
    await service.checkout('user-1', DTO, KEY);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('releases the key when the checkout fails, so the same key can be retried', async () => {
    const { service, cache } = createService({ lines: [] });

    await expect(service.checkout('user-1', DTO, KEY)).rejects.toThrow(BadRequestException);

    // A refusal the customer can fix — an empty cart, a dead promocode — must
    // not burn the attempt.
    expect(cache.store.has('order:idem:user-1:attempt-0001')).toBe(false);
  });

  it('scopes the persisted key to the customer', async () => {
    const { service, prisma } = createService();
    await service.checkout('user-1', DTO, KEY);
    expect(prisma.order.create.mock.calls[0][0].data).toMatchObject({
      userId: 'user-1',
      idempotencyKey: KEY,
    });
  });

  it('creates one order for two concurrent submissions', async () => {
    const { service, prisma } = createService();
    await Promise.all([service.checkout('user-1', DTO, KEY), service.checkout('user-1', DTO, KEY)]);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(prisma.eventOutbox.createMany).toHaveBeenCalledTimes(1);
  });

  it('reuses the order after cart cleanup fails following commit', async () => {
    const { service, cart, prisma } = createService();
    cart.clear.mockRejectedValue(new Error('Redis offline'));
    await service.checkout('user-1', DTO, KEY);
    await service.checkout('user-1', DTO, KEY);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });

  it('treats a different key as a new order', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', DTO, 'attempt-0001');
    await service.checkout('user-1', DTO, 'attempt-0002');

    expect(prisma.order.create).toHaveBeenCalledTimes(2);
  });

  it('still places an order when the client sends no key at all', async () => {
    const { service, prisma, cache } = createService();

    await service.checkout('user-1', DTO);

    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(cache.setIfAbsent).not.toHaveBeenCalled();
  });
});

/**
 * The verification flow was fully built and then required by nothing: the
 * flag was drawn on the profile page and never consulted. Signing up with a
 * stranger's address and ordering to a real doorstep worked fine.
 */
describe('OrderService — checkout requires a verified email', () => {
  it('refuses an unverified customer', async () => {
    const { service, prisma } = createService();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ isEmailVerified: false });

    await expect(service.checkout('user-1', DTO)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('checks before touching the cart or the products service', async () => {
    const { service, prisma, cart, products } = createService();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ isEmailVerified: false });

    await expect(service.checkout('user-1', DTO)).rejects.toBeInstanceOf(ForbiddenException);
    expect(cart.getRawLines).not.toHaveBeenCalled();
    expect(products.send).not.toHaveBeenCalled();
  });

  it('lets a verified customer through', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', DTO);

    expect(prisma.order.create).toHaveBeenCalled();
  });

  it('releases the idempotency key, so the same attempt works once verified', async () => {
    const { service, prisma, cache } = createService();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ isEmailVerified: false });

    await expect(service.checkout('user-1', DTO, 'attempt-0001')).rejects.toBeInstanceOf(ForbiddenException);

    expect(cache.store.size).toBe(0);
  });
});

/**
 * A collection and a delivery are different orders: one has a kitchen and no
 * address, the other has an address and is assigned a kitchen. The fee is the
 * visible difference — nobody drives anywhere, so nobody pays for it.
 */
describe('OrderService — collecting instead of delivering', () => {
  const PICKUP = {
    fulfillment: 'PICKUP',
    branchId: 'branch-1',
    paymentMethod: 'CASH_ON_DELIVERY',
    deliveryType: 'ASAP',
  } as never;

  it('charges nothing for delivery', async () => {
    const { service, prisma } = createService({ subtotal: 50_000 });

    await service.checkout('user-1', PICKUP);

    expect(orderDataOf(prisma)).toMatchObject({ deliveryFee: 0, total: 50_000 });
  });

  it('stores the branch and no address', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', PICKUP);

    expect(orderDataOf(prisma)).toMatchObject({
      fulfillment: 'PICKUP',
      branchId: 'branch-1',
      addressId: null,
    });
  });

  it('does not look for an address it does not need', async () => {
    const { service, prisma } = createService();

    await service.checkout('user-1', PICKUP);

    expect(prisma.address.findFirst).not.toHaveBeenCalled();
  });

  it('validates the branch the customer named', async () => {
    const { service, products } = createService();

    await service.checkout('user-1', PICKUP);

    expect(products.send).toHaveBeenCalledWith('products.get_orderable_branch', {
      branchId: 'branch-1',
    });
  });

  it('refuses a collection from a branch that is closed for good', async () => {
    const { service, products } = createService();
    products.send.mockImplementation((pattern: string) =>
      pattern === 'products.get_orderable_branch'
        ? throwError(() => ({ statusCode: 404, message: 'Пиццерия не найдена или закрыта' }))
        : of({ items: [], subtotal: 0, unavailable: [] }),
    );

    // `rpcSend` turns the refusal from products into an HttpException, so the
    // customer sees the kitchen's own words rather than a generic 500.
    await expect(service.checkout('user-1', PICKUP)).rejects.toThrow('Пиццерия не найдена или закрыта');
  });

  it('assigns a delivery to a branch without being asked', async () => {
    const { service, prisma, products } = createService();

    await service.checkout('user-1', DTO);

    expect(products.send).toHaveBeenCalledWith('products.default_delivery_branch', {});
    expect(orderDataOf(prisma)).toMatchObject({ fulfillment: 'DELIVERY', branchId: 'branch-1' });
  });

  it('still charges for a delivery', async () => {
    const { service, prisma } = createService({ subtotal: 50_000 });

    await service.checkout('user-1', DTO);

    expect(orderDataOf(prisma).deliveryFee).toBeGreaterThan(0);
  });
});

/**
 * The whole point of a second kitchen is that it can keep different hours, so
 * a scheduled order is checked against the branch that will cook it.
 */
describe('OrderService — scheduling against the branch’s own hours', () => {
  const scheduledPickup = (hour: number) =>
    ({
      fulfillment: 'PICKUP',
      branchId: 'branch-1',
      deliveryType: 'SCHEDULED',
      scheduledAt: tomorrowAt(hour),
      paymentMethod: 'CASH_ON_DELIVERY',
    }) as never;

  it('accepts a slot the branch is open for but the default hours are not', async () => {
    const { service, branch } = createService();
    // The all-night branch: 11:30 → 06:00. `closeMinute` below `openMinute`
    // is how the model spells "past midnight", and this is the case that a
    // plain `open <= t < close` comparison gets wrong — it would leave this
    // kitchen shut at every hour of the day.
    branch.closeMinute = 6 * 60;

    // 01:30, long past the company default of 23:30.
    await expect(service.checkout('user-1', scheduledPickup(1))).resolves.toBeDefined();
  });

  it('refuses a slot after the branch closes, even inside company hours', async () => {
    const { service, branch } = createService();
    branch.closeMinute = 20 * 60;

    await expect(service.checkout('user-1', scheduledPickup(21))).rejects.toThrow(
      /работает с 11:30 до 20:00/,
    );
  });

  it('refuses the small hours at a branch that does not work through them', async () => {
    const { service } = createService();

    // Same 01:30 slot as the accepting test above, at the ordinary branch.
    await expect(service.checkout('user-1', scheduledPickup(1))).rejects.toThrow(/работает с 11:30 до 23:30/);
  });
});

/**
 * A flat tariff across a city is a promise the kitchen cannot keep evenly:
 * the same fee buys a five-minute hop downtown and a half-hour run to the
 * edge of town.
 */
describe('OrderService — delivery zones', () => {
  const inCentre = (over: Record<string, unknown> = {}) => ({
    id: 'zone-centre',
    name: 'Центр',
    branchId: 'branch-1',
    deliveryFee: 10_000,
    minOrderAmount: 0,
    ...over,
  });

  it('charges the zone’s own price instead of the flat tariff', async () => {
    const { service, prisma, zoneLookup } = createService({ subtotal: 50_000 });
    Object.assign(zoneLookup, { configured: true, zone: inCentre() });

    await service.checkout('user-1', DTO);

    expect(orderDataOf(prisma)).toMatchObject({ deliveryFee: 10_000, total: 60_000 });
  });

  it('asks about the address’s own coordinates', async () => {
    const { service, products } = createService();

    await service.checkout('user-1', DTO);

    expect(products.send).toHaveBeenCalledWith('products.resolve_delivery_zone', {
      lat: 42.98,
      lng: 47.5,
    });
  });

  it('routes the order to the kitchen that covers the zone', async () => {
    const { service, products, zoneLookup } = createService();
    Object.assign(zoneLookup, { configured: true, zone: inCentre({ branchId: 'branch-7' }) });

    await service.checkout('user-1', DTO);

    expect(products.send).toHaveBeenCalledWith('products.get_orderable_branch', {
      branchId: 'branch-7',
    });
  });

  it('turns away an address outside every zone', async () => {
    const { service, prisma, zoneLookup } = createService();
    Object.assign(zoneLookup, { configured: true, zone: null });

    await expect(service.checkout('user-1', DTO)).rejects.toThrow(/не доставляем по этому адресу/);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('refuses an order below the zone’s minimum, naming the zone', async () => {
    const { service, zoneLookup } = createService({ subtotal: 50_000 });
    Object.assign(zoneLookup, { configured: true, zone: inCentre({ minOrderAmount: 100_000 }) });

    await expect(service.checkout('user-1', DTO)).rejects.toThrow(/Центр.*1000/);
  });

  it('measures the minimum against the food, not the discounted total', async () => {
    const { service, zoneLookup } = createService({ subtotal: 100_000 });
    Object.assign(zoneLookup, { configured: true, zone: inCentre({ minOrderAmount: 100_000 }) });

    // A promocode must not push an order under the minimum: the minimum is
    // about the length of the drive, not about what was finally paid.
    await expect(
      service.checkout('user-1', { ...(DTO as object), promocode: 'CHICAGO10' } as never),
    ).resolves.toBeDefined();
  });

  /**
   * Every address saved before the map existed has no coordinates, so those
   * cannot be tested against a polygon at all. Turning them away would lock
   * out existing customers; the flat tariff is the honest fallback.
   */
  it('falls back to the flat tariff for an address with no pin', async () => {
    const { service, prisma, products } = createService({ subtotal: 50_000 });
    prisma.address.findFirst.mockResolvedValue({ id: 'addr-1', userId: 'user-1', lat: null, lng: null });

    await service.checkout('user-1', DTO);

    expect(products.send).not.toHaveBeenCalledWith('products.resolve_delivery_zone', expect.anything());
    expect(orderDataOf(prisma).deliveryFee).toBeGreaterThan(0);
  });

  it('keeps the flat tariff for a shop that never drew a zone', async () => {
    const { service, prisma } = createService({ subtotal: 50_000 });

    await service.checkout('user-1', DTO);

    expect(orderDataOf(prisma)).toMatchObject({ deliveryFee: 15_000 });
  });

  it('never asks about zones for a collection', async () => {
    const { service, products } = createService();

    await service.checkout('user-1', {
      fulfillment: 'PICKUP',
      branchId: 'branch-1',
      deliveryType: 'ASAP',
      paymentMethod: 'CASH_ON_DELIVERY',
    } as never);

    expect(products.send).not.toHaveBeenCalledWith('products.resolve_delivery_zone', expect.anything());
  });
});

/**
 * The kitchen screen watches one branch, and only what is still in play: a
 * board carrying yesterday's delivered orders is a board nobody reads.
 */
describe('OrderService — the kitchen board', () => {
  const board = (over: Record<string, unknown>) =>
    ({ page: 1, limit: 50, actorId: 'admin-1', actorRole: 'ADMIN', ...over }) as never;

  const whereOf = (prisma: Record<string, any>) => prisma.order.findMany.mock.calls[0][0].where;

  it('narrows to one branch', async () => {
    const { service, prisma } = createService();

    await service.adminListOrders(board({ branchId: 'branch-1' }));

    expect(whereOf(prisma)).toMatchObject({ branchId: 'branch-1' });
  });

  it('drops finished orders when asked for the live board', async () => {
    const { service, prisma } = createService();

    await service.adminListOrders(board({ liveOnly: true }));

    expect(whereOf(prisma)).toMatchObject({ status: { notIn: ['DELIVERED', 'CANCELLED'] } });
  });

  it('lets an explicit status win over liveOnly', async () => {
    const { service, prisma } = createService();

    // Asking for DELIVERED means the operator wants history, not the board.
    await service.adminListOrders(board({ liveOnly: true, status: 'DELIVERED' }));

    expect(whereOf(prisma)).toMatchObject({ status: 'DELIVERED' });
  });

  it('leaves the plain admin list unfiltered', async () => {
    const { service, prisma } = createService();

    await service.adminListOrders(board({}));

    expect(whereOf(prisma)).toEqual({});
  });

  it('still scopes a courier to their own deliveries', async () => {
    const { service, prisma } = createService();

    await service.adminListOrders(
      board({ actorRole: 'COURIER', actorId: 'courier-1', branchId: 'branch-1' }),
    );

    expect(whereOf(prisma)).toMatchObject({
      branchId: 'branch-1',
      OR: [{ courierId: 'courier-1' }, { courierId: null }],
    });
  });
});

describe('live kitchen board excludes unpaid online orders', () => {
  it('filters both missing and pending payment rows', async () => {
    const { service, prisma } = createService();
    await service.adminListOrders({
      page: 1,
      limit: 50,
      liveOnly: true,
      actorId: 'admin-1',
      actorRole: 'ADMIN',
    } as never);
    expect(prisma.order.findMany.mock.calls[0][0].where.NOT).toMatchObject({
      paymentMethod: 'ONLINE',
      OR: [{ payment: { is: null } }, { payment: { is: { status: { not: 'SUCCEEDED' } } } }],
    });
  });
});
