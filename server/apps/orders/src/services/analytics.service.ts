import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, PrismaService } from '@chicago-pizza/prisma';
import { BUSINESS_TIMEZONE, RedisCacheService } from '@chicago-pizza/common';
import { createHash } from 'crypto';

/** How many menu items the "what sells" list shows. */
const TOP_PRODUCTS = 10;

/**
 * How long a report is reused.
 *
 * A dashboard is read repeatedly — an owner leaves it open, refreshes, changes
 * the branch and changes it back — and each read was six queries, three of them
 * range scans over `orders` joined to `order_items`. A minute of staleness is
 * invisible in a figure about yesterday's revenue and turns a burst of reloads
 * into one query set.
 */
const SUMMARY_TTL_SECONDS = 60;

/**
 * The longest period a single report may cover.
 *
 * Without a cap, `from=1970-01-01` was a full scan of the two largest tables in
 * the database, available to anyone with an admin session and a URL. A year and
 * a day covers every question an owner actually asks — this year against last —
 * and anything beyond it is an export, not a dashboard.
 */
const MAX_RANGE_DAYS = 366;
const MAX_RANGE_MS = MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;

export interface AnalyticsRange {
  from: Date;
  to: Date;
  branchId?: string;
}

export interface DailyRevenue {
  /** `YYYY-MM-DD` in the pizzeria's timezone. */
  date: string;
  revenue: number;
  orders: number;
}

export interface AnalyticsSummary {
  revenue: number;
  orders: number;
  averageCheque: number;
  cancellationRate: number;
  fulfillment: { delivery: number; pickup: number };
  revenueByDay: DailyRevenue[];
  topProducts: { productName: string; quantity: number; revenue: number }[];
  promocodes: { code: string; uses: number; discount: number }[];
}

/**
 * The numbers an owner actually asks for.
 *
 * Every figure counts delivered orders only. Revenue that includes orders
 * still in the oven flatters the day and then quietly contradicts itself when
 * one of them is cancelled; a cancelled order is money that never arrived, and
 * the cancellation rate is reported separately so it cannot hide.
 *
 * Days are cut in the pizzeria's timezone, not the server's. The shop closes
 * at 23:00 local, which is 20:00 UTC — grouping by a UTC day would file the
 * last hours of every evening under the wrong date, which is exactly the class
 * of bug that once made the opening hours mean 13:00–02:00.
 *
 * The conversion is deliberately two steps. Prisma stores `DateTime` as
 * `timestamp` *without* a time zone, so a single `AT TIME ZONE 'Europe/Moscow'`
 * would read the stored UTC value as if it were already Moscow time and shift
 * it the wrong way — silently, and only for the three hours either side of
 * midnight. Tagging it as UTC first is what makes the second conversion mean
 * what it says.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: RedisCacheService,
  ) {}

  async summary(range: AnalyticsRange): Promise<AnalyticsSummary> {
    this.assertSaneRange(range);

    return this.cache.wrap(this.cacheKey(range), SUMMARY_TTL_SECONDS, () => this.computeSummary(range));
  }

  /**
   * A period has to be a period: ordered, and bounded.
   *
   * Both checks are about the same thing — a report nobody asked for. Reversed
   * dates answer zero of everything, which reads as "the shop sold nothing"
   * rather than as a mistake; an unbounded range scans the whole table to say
   * it.
   */
  private assertSaneRange(range: AnalyticsRange): void {
    if (Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime())) {
      throw new BadRequestException('Некорректные даты периода');
    }

    if (range.to <= range.from) {
      throw new BadRequestException('Конец периода должен быть позже начала');
    }

    if (range.to.getTime() - range.from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException(`Период не может превышать ${MAX_RANGE_DAYS} дней`);
    }
  }

  /** A fixed-length key per period and branch, hashed the way the catalog's is. */
  private cacheKey(range: AnalyticsRange): string {
    const fingerprint = createHash('sha1')
      .update(`${range.from.toISOString()}|${range.to.toISOString()}|${range.branchId ?? ''}`)
      .digest('hex');

    return `analytics:summary:${fingerprint}`;
  }

  private async computeSummary(range: AnalyticsRange): Promise<AnalyticsSummary> {
    const [totals, statusCounts, fulfillment, revenueByDay, topProducts, promocodes] = await Promise.all([
      this.totals(range),
      this.statusCounts(range),
      this.fulfillmentSplit(range),
      this.revenueByDay(range),
      this.topProducts(range),
      this.promocodeUse(range),
    ]);

    const delivered = statusCounts[OrderStatus.DELIVERED] ?? 0;
    const cancelled = statusCounts[OrderStatus.CANCELLED] ?? 0;
    const settled = delivered + cancelled;

    return {
      revenue: totals.revenue,
      orders: delivered,
      // Rounded to whole kopecks: an average of a third of a kopeck is noise.
      averageCheque: delivered ? Math.round(totals.revenue / delivered) : 0,
      // Out of orders that reached an end, not out of everything: orders still
      // in the oven have not had the chance to be cancelled yet.
      cancellationRate: settled ? cancelled / settled : 0,
      fulfillment,
      revenueByDay,
      topProducts,
      promocodes,
    };
  }

  private async totals(range: AnalyticsRange): Promise<{ revenue: number }> {
    const result = await this.prisma.order.aggregate({
      where: this.where(range, OrderStatus.DELIVERED),
      _sum: { total: true },
    });

    return { revenue: result._sum.total ?? 0 };
  }

  private async statusCounts(range: AnalyticsRange): Promise<Partial<Record<OrderStatus, number>>> {
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      where: this.where(range),
      _count: { _all: true },
    });

    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }

  private async fulfillmentSplit(range: AnalyticsRange): Promise<{ delivery: number; pickup: number }> {
    const rows = await this.prisma.order.groupBy({
      by: ['fulfillment'],
      where: this.where(range, OrderStatus.DELIVERED),
      _count: { _all: true },
    });

    const byType = Object.fromEntries(rows.map((row) => [row.fulfillment, row._count._all]));
    return { delivery: byType.DELIVERY ?? 0, pickup: byType.PICKUP ?? 0 };
  }

  /**
   * Revenue per calendar day, in the shop's own timezone.
   *
   * Raw SQL because `date_trunc` has no Prisma equivalent, and doing it in
   * application code would mean pulling every order in the range across the
   * wire to add them up here.
   */
  private async revenueByDay(range: AnalyticsRange): Promise<DailyRevenue[]> {
    const rows = await this.prisma.$queryRaw<{ day: string; revenue: bigint; orders: bigint }[]>(Prisma.sql`
      SELECT to_char(
               date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIMEZONE}),
               'YYYY-MM-DD'
             ) AS day,
             COALESCE(SUM("total"), 0)::bigint AS revenue,
             COUNT(*)::bigint AS orders
      FROM "orders"
      WHERE "status" = ${OrderStatus.DELIVERED}::"OrderStatus"
        AND "createdAt" >= ${range.from}
        AND "createdAt" < ${range.to}
        ${range.branchId ? Prisma.sql`AND "branchId" = ${range.branchId}` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1
    `);

    // Postgres returns bigint for SUM/COUNT, and a bigint cannot be JSON —
    // this answer travels over RabbitMQ.
    return rows.map((row) => ({
      date: row.day,
      revenue: Number(row.revenue),
      orders: Number(row.orders),
    }));
  }

  private async topProducts(range: AnalyticsRange): Promise<AnalyticsSummary['topProducts']> {
    const rows = await this.prisma.$queryRaw<
      { productName: string; quantity: bigint; revenue: bigint }[]
    >(Prisma.sql`
      SELECT items."productName",
             SUM(items."quantity")::bigint AS quantity,
             SUM(items."totalPrice")::bigint AS revenue
      FROM "order_items" items
      JOIN "orders" o ON o."id" = items."orderId"
      WHERE o."status" = ${OrderStatus.DELIVERED}::"OrderStatus"
        AND o."createdAt" >= ${range.from}
        AND o."createdAt" < ${range.to}
        ${range.branchId ? Prisma.sql`AND o."branchId" = ${range.branchId}` : Prisma.empty}
      GROUP BY 1
      ORDER BY revenue DESC
      LIMIT ${TOP_PRODUCTS}
    `);

    return rows.map((row) => ({
      productName: row.productName,
      quantity: Number(row.quantity),
      revenue: Number(row.revenue),
    }));
  }

  /**
   * What the promocodes actually cost, and how often they were used.
   *
   * A code that was issued and never redeemed is not in this list, which is
   * the honest answer to "did the campaign work": it did nothing.
   *
   * The cost is reconstructed from the promocode's own terms, not read off
   * `orders.discount`. That column is the *total* discount — the promocode plus
   * whatever loyalty points the customer spent on the same order — so a 10%
   * code on an order that also burned 500 points was reported as having cost
   * the shop 500 ₽ more than it did. Every figure in this report is something
   * an owner makes decisions with; "this campaign cost us X" being silently
   * inflated by an unrelated mechanism is the kind of wrong that gets a working
   * promotion cancelled.
   *
   * Recomputed rather than stored because the discount a code produced is a
   * function of its terms and the subtotal it was applied to, both of which the
   * order still carries. `LEAST` mirrors `PromocodeService.validate`, which
   * never returns more than the subtotal.
   */
  private async promocodeUse(range: AnalyticsRange): Promise<AnalyticsSummary['promocodes']> {
    const rows = await this.prisma.$queryRaw<{ code: string; uses: bigint; discount: bigint }[]>(Prisma.sql`
      SELECT p."code",
             COUNT(*)::bigint AS uses,
             COALESCE(SUM(
               LEAST(
                 CASE WHEN p."discountType" = 'PERCENT'
                      THEN FLOOR(o."subtotal" * p."discountValue" / 100.0)
                      ELSE p."discountValue"
                 END,
                 o."subtotal"
               )
             ), 0)::bigint AS discount
      FROM "orders" o
      JOIN "promocodes" p ON p."id" = o."promocodeId"
      WHERE o."status" = ${OrderStatus.DELIVERED}::"OrderStatus"
        AND o."createdAt" >= ${range.from}
        AND o."createdAt" < ${range.to}
        ${range.branchId ? Prisma.sql`AND o."branchId" = ${range.branchId}` : Prisma.empty}
      GROUP BY 1
      ORDER BY uses DESC
    `);

    return rows.map((row) => ({
      code: row.code,
      uses: Number(row.uses),
      discount: Number(row.discount),
    }));
  }

  private where(range: AnalyticsRange, status?: OrderStatus): Prisma.OrderWhereInput {
    return {
      createdAt: { gte: range.from, lt: range.to },
      ...(status ? { status } : {}),
      ...(range.branchId ? { branchId: range.branchId } : {}),
    };
  }
}
