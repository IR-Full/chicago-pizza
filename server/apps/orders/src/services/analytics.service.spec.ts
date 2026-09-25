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
    $queryRaw: jest.fn(async () => raw[rawCall++] ?? []),
  };

  return { service: new AnalyticsService(prisma as never), prisma };
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
