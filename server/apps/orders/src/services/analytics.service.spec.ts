import { AnalyticsService } from './analytics.service';

const RANGE = { from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-10-01T00:00:00.000Z') };

interface Fixture {
  revenue?: number;
  statuses?: { status: string; count: number }[];
  fulfillment?: { fulfillment: string; count: number }[];
  /** Answers to `$queryRaw`, in call order: days, products, promocodes. */
  raw?: unknown[][];
}

function createService(fixture: Fixture = {}) {
  const raw = fixture.raw ?? [[], [], []];
  let rawCall = 0;

  const prisma = {
    order: {
      aggregate: jest.fn(async () => ({ _sum: { total: fixture.revenue ?? 0 } })),
      groupBy: jest.fn(async ({ by }: { by: string[] }) =>
        by[0] === 'status'
          ? (fixture.statuses ?? []).map((row) => ({ status: row.status, _count: { _all: row.count } }))
          : (fixture.fulfillment ?? []).map((row) => ({
              fulfillment: row.fulfillment,
              _count: { _all: row.count },
            })),
      ),
    },
    // Varargs so a test can read back the SQL it was handed.
    $queryRaw: jest.fn(async (..._args: unknown[]) => raw[rawCall++] ?? []),
  };

  // `wrap` is exercised on its own in libs/common; here it must simply not hide
  // the queries from the assertions.
  const cache = {
    wrap: jest.fn(async (_key: string, _ttl: number, factory: () => Promise<unknown>) => factory()),
  };

  return { service: new AnalyticsService(prisma as never, cache as never), prisma, cache };
}

describe('AnalyticsService — the headline figures', () => {
  it('reports revenue and the number of delivered orders', async () => {
    const { service } = createService({
      revenue: 300_000,
      statuses: [{ status: 'DELIVERED', count: 4 }],
    });

    await expect(service.summary(RANGE)).resolves.toMatchObject({ revenue: 300_000, orders: 4 });
  });

  it('divides revenue by delivered orders for the average cheque', async () => {
    const { service } = createService({
      revenue: 300_000,
      statuses: [{ status: 'DELIVERED', count: 4 }],
    });

    const { averageCheque } = await service.summary(RANGE);

    expect(averageCheque).toBe(75_000);
  });

  it('rounds the average to whole kopecks', async () => {
    const { service } = createService({
      revenue: 100_00,
      statuses: [{ status: 'DELIVERED', count: 3 }],
    });

    const { averageCheque } = await service.summary(RANGE);

    // A third of a kopeck is noise, not precision.
    expect(averageCheque).toBe(3_333);
  });

  it('answers zero for a period with nothing in it, not NaN', async () => {
    const { service } = createService();

    await expect(service.summary(RANGE)).resolves.toMatchObject({
      revenue: 0,
      orders: 0,
      averageCheque: 0,
      cancellationRate: 0,
    });
  });

  /**
   * Revenue counts delivered orders only. Including orders still in the oven
   * flatters the day and then contradicts itself when one is cancelled.
   */
  it('asks the database for delivered orders when totalling revenue', async () => {
    const { service, prisma } = createService();

    await service.summary(RANGE);

    expect(prisma.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'DELIVERED' }) }),
    );
  });
});

describe('AnalyticsService — cancellations', () => {
  it('measures cancellations against orders that reached an end', async () => {
    const { service } = createService({
      statuses: [
        { status: 'DELIVERED', count: 8 },
        { status: 'CANCELLED', count: 2 },
        // Still cooking: it has not had its chance to be cancelled yet, so it
        // must not dilute the rate.
        { status: 'PREPARING', count: 10 },
      ],
    });

    const { cancellationRate } = await service.summary(RANGE);

    expect(cancellationRate).toBe(0.2);
  });

  it('reports no rate at all when nothing has finished', async () => {
    const { service } = createService({ statuses: [{ status: 'CREATED', count: 5 }] });

    await expect(service.summary(RANGE)).resolves.toMatchObject({ cancellationRate: 0 });
  });

  it('reports a total loss honestly', async () => {
    const { service } = createService({ statuses: [{ status: 'CANCELLED', count: 3 }] });

    await expect(service.summary(RANGE)).resolves.toMatchObject({ cancellationRate: 1 });
  });
});

describe('AnalyticsService — the split between delivery and pickup', () => {
  it('counts each kind', async () => {
    const { service } = createService({
      fulfillment: [
        { fulfillment: 'DELIVERY', count: 7 },
        { fulfillment: 'PICKUP', count: 3 },
      ],
    });

    await expect(service.summary(RANGE)).resolves.toMatchObject({
      fulfillment: { delivery: 7, pickup: 3 },
    });
  });

  it('reports zero for a kind nobody chose', async () => {
    const { service } = createService({ fulfillment: [{ fulfillment: 'DELIVERY', count: 5 }] });

    await expect(service.summary(RANGE)).resolves.toMatchObject({
      fulfillment: { delivery: 5, pickup: 0 },
    });
  });
});

/**
 * Postgres answers SUM and COUNT as bigint, which `JSON.stringify` refuses —
 * and this report travels to the gateway over RabbitMQ.
 */
describe('AnalyticsService — numbers that survive the wire', () => {
  it('converts the daily figures out of bigint', async () => {
    const { service } = createService({
      raw: [[{ day: '2026-09-20', revenue: 150_000n, orders: 2n }], [], []],
    });

    const { revenueByDay } = await service.summary(RANGE);

    expect(revenueByDay).toEqual([{ date: '2026-09-20', revenue: 150_000, orders: 2 }]);
    expect(() => JSON.stringify(revenueByDay)).not.toThrow();
  });

  it('converts the top products', async () => {
    const { service } = createService({
      raw: [[], [{ productName: 'Пепперони', quantity: 12n, revenue: 756_000n }], []],
    });

    await expect(service.summary(RANGE)).resolves.toMatchObject({
      topProducts: [{ productName: 'Пепперони', quantity: 12, revenue: 756_000 }],
    });
  });

  it('converts the promocode figures', async () => {
    const { service } = createService({
      raw: [[], [], [{ code: 'CHICAGO10', uses: 4n, discount: 25_200n }]],
    });

    await expect(service.summary(RANGE)).resolves.toMatchObject({
      promocodes: [{ code: 'CHICAGO10', uses: 4, discount: 25_200 }],
    });
  });

  /**
   * `orders.discount` is the *total* discount — the promocode plus any loyalty
   * points spent on the same order — so summing it reported a 10% code as having
   * cost the shop whatever the customer also paid in points. "This campaign cost
   * us X" being silently inflated by an unrelated mechanism is the kind of wrong
   * that gets a working promotion cancelled.
   */
  it('derives what a promocode cost from its own terms, not from the order’s total discount', async () => {
    const { service, prisma } = createService();

    await service.summary(RANGE);

    const promocodeQuery = prisma.$queryRaw.mock.calls[2]?.[0] as { sql?: string } | undefined;
    const sql = String(promocodeQuery?.sql ?? '');
    expect(sql).not.toMatch(/SUM\(o\."discount"\)/);
    expect(sql).toMatch(/p\."discountValue"/);
    // Mirrors `PromocodeService.validate`, which never returns more than the
    // subtotal.
    expect(sql).toMatch(/LEAST/);
  });
});

/**
 * Prisma stores `DateTime` as `timestamp` *without* a time zone, so a single
 * `AT TIME ZONE 'Europe/Moscow'` reads the stored UTC value as if it were
 * already Moscow time and shifts it the wrong way — silently, and only for the
 * three hours either side of midnight. An order at 00:30 in Makhachkala was
 * filed under the previous day.
 *
 * This pins the shape of the conversion so it cannot be "simplified" back.
 */
describe('AnalyticsService — the day boundary', () => {
  const daySql = (prisma: { $queryRaw: jest.Mock }) => String(prisma.$queryRaw.mock.calls[0][0].sql ?? '');

  it('tags the stored timestamp as UTC before converting it', async () => {
    const { service, prisma } = createService();

    await service.summary(RANGE);

    expect(daySql(prisma)).toContain(`("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE`);
  });

  it('groups by a truncated day, not by the raw timestamp', async () => {
    const { service, prisma } = createService();

    await service.summary(RANGE);

    expect(daySql(prisma)).toContain("date_trunc('day'");
  });
});

describe('AnalyticsService — scoping', () => {
  it('narrows every figure to one branch when asked', async () => {
    const { service, prisma } = createService();

    await service.summary({ ...RANGE, branchId: 'branch-1' });

    expect(prisma.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: 'branch-1' }) }),
    );
  });

  it('bounds every figure by the window', async () => {
    const { service, prisma } = createService();

    await service.summary(RANGE);

    expect(prisma.order.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdAt: { gte: RANGE.from, lt: RANGE.to } }),
      }),
    );
  });
});

describe('AnalyticsService — the report is cached, and the period is bounded', () => {
  it('reads through the cache for a minute', async () => {
    const { service, cache } = createService();

    await service.summary(RANGE);

    expect(cache.wrap).toHaveBeenCalledWith(
      expect.stringMatching(/^analytics:summary:/),
      60,
      expect.any(Function),
    );
  });

  it('keys the cache per period and per branch', async () => {
    const { service, cache } = createService();

    await service.summary(RANGE);
    await service.summary({ ...RANGE, branchId: 'branch-1' });
    await service.summary({ ...RANGE, to: new Date('2026-10-02T00:00:00.000Z') });

    const keys = cache.wrap.mock.calls.map(([key]) => key);
    expect(new Set(keys).size).toBe(3);
  });

  it('runs the queries once for a repeated period', async () => {
    // With a real cache the second call is a Redis read, not six queries against
    // the two largest tables in the database.
    const store = new Map<string, unknown>();
    const { service, prisma } = createService();
    // Swaps in a stateful stub, which is the point of the test.
    (service as unknown as { cache: unknown }).cache = {
      wrap: async (key: string, _ttl: number, factory: () => Promise<unknown>) => {
        if (!store.has(key)) store.set(key, await factory());
        return store.get(key);
      },
    };

    await service.summary(RANGE);
    await service.summary(RANGE);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('refuses a period longer than a year and a day', async () => {
    const { service, prisma } = createService();

    await expect(
      service.summary({
        from: new Date('2020-01-01T00:00:00.000Z'),
        to: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow('Период не может превышать 366 дней');

    // And it refuses before touching the database, which is the point.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('accepts exactly a year and a day', async () => {
    const { service } = createService();

    await expect(
      service.summary({
        from: new Date('2026-01-01T00:00:00.000Z'),
        to: new Date('2027-01-02T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ orders: 0 });
  });

  it('refuses a reversed period instead of reporting zero of everything', async () => {
    const { service } = createService();

    await expect(service.summary({ from: RANGE.to, to: RANGE.from })).rejects.toThrow(
      'Конец периода должен быть позже начала',
    );
  });

  it('refuses an unparseable date', async () => {
    const { service } = createService();

    await expect(service.summary({ from: new Date('nonsense'), to: RANGE.to })).rejects.toThrow(
      'Некорректные даты периода',
    );
  });
});
