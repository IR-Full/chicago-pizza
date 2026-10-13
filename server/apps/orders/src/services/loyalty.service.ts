import { ConflictException, Injectable } from '@nestjs/common';
import { LoyaltyLevel, LoyaltyTxType, Prisma, PrismaService } from '@chicago-pizza/prisma';
import { POINT_VALUE_KOPECKS } from '@chicago-pizza/common';

/**
 * Loyalty rules:
 *  - Cashback rate depends on the customer's level.
 *  - The level is derived from lifetime spend, recomputed after each order.
 *  - Points are kopecks-equivalent: 1 point = 1 ₽ off a future order.
 *
 * Two different amounts are in play, and the difference is deliberate rather
 * than an oversight — it looked like one, so it is written down here.
 *
 * *Cashback* is earned on `subtotal - discount`: what the customer paid for
 * food, out of their own pocket. Not the delivery fee, which is the courier's
 * wage rather than a purchase, and not the part of the bill that points or a
 * promocode already covered — paying cashback on points spent compounds, since
 * spending points would earn points that buy a discount that earns points
 * again.
 *
 * *Level* is derived from the sum of `order.total` over delivered orders: the
 * whole bill, delivery included. That is the figure that answers "how much has
 * this person been worth to the shop", which is what a tier is for — and it
 * moves in the customer's favour, since a frequent customer reaches GOLD
 * sooner than a stricter measure would allow. The two are measuring different
 * things on purpose: one is a payout, the other is a ranking.
 */
const LEVEL_THRESHOLDS: { level: LoyaltyLevel; minLifetimeSpend: number; cashbackPercent: number }[] = [
  { level: LoyaltyLevel.GOLD, minLifetimeSpend: 3_000_00, cashbackPercent: 10 },
  { level: LoyaltyLevel.SILVER, minLifetimeSpend: 1_000_00, cashbackPercent: 7 },
  { level: LoyaltyLevel.BRONZE, minLifetimeSpend: 0, cashbackPercent: 5 },
];

const REFERRAL_BONUS_POINTS = 300;

/** No points changed hands, so there is no ledger row to link to an order. */
const NOTHING_SPENT = { discount: 0, transactionId: null } as const;

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  cashbackPercentFor(level: LoyaltyLevel): number {
    return LEVEL_THRESHOLDS.find((t) => t.level === level)!.cashbackPercent;
  }

  levelFor(lifetimeSpend: number): LoyaltyLevel {
    return LEVEL_THRESHOLDS.find((t) => lifetimeSpend >= t.minLifetimeSpend)!.level;
  }

  /**
   * Awards cashback for a delivered order and re-evaluates the customer's
   * level. Runs inside the caller's transaction so points can never be
   * granted for an order that failed to commit.
   *
   * `eligibleAmount` is what the customer actually paid for food: the
   * subtotal less every discount. It used to be the order total, which is the
   * same figure plus delivery and minus nothing — so cashback was paid on the
   * delivery fee, and on the part of the bill already settled with points.
   * The second one compounds: spending points earned points, which bought a
   * discount that earned points again.
   */
  async awardForOrder(tx: Prisma.TransactionClient, userId: string, orderId: string, eligibleAmount: number) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const points = Math.floor(
      (Math.max(0, eligibleAmount) * this.cashbackPercentFor(user.loyaltyLevel)) / 100 / 100,
    );

    const lifetime = await tx.order.aggregate({
      where: { userId, status: 'DELIVERED' },
      _sum: { total: true },
    });
    const newLevel = this.levelFor(lifetime._sum.total ?? 0);

    await tx.user.update({
      where: { id: userId },
      data: { loyaltyPoints: { increment: points }, loyaltyLevel: newLevel },
    });
    await tx.loyaltyTransaction.create({
      data: { userId, orderId, points, type: LoyaltyTxType.EARN },
    });
    await tx.order.update({ where: { id: orderId }, data: { loyaltyPointsEarned: points } });

    return { points, newLevel };
  }

  /** Grants the referrer their bonus the first time the invitee's order is delivered. */
  async settleReferral(tx: Prisma.TransactionClient, referredUserId: string) {
    const referral = await tx.referral.findUnique({ where: { referredUserId } });
    if (!referral || referral.rewardGranted) return null;

    await tx.user.update({
      where: { id: referral.referrerId },
      data: { loyaltyPoints: { increment: REFERRAL_BONUS_POINTS } },
    });
    await tx.loyaltyTransaction.create({
      data: {
        userId: referral.referrerId,
        points: REFERRAL_BONUS_POINTS,
        type: LoyaltyTxType.REFERRAL_BONUS,
      },
    });
    await tx.referral.update({ where: { id: referral.id }, data: { rewardGranted: true } });

    return { referrerId: referral.referrerId, points: REFERRAL_BONUS_POINTS };
  }

  async getSummary(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { loyaltyPoints: true, loyaltyLevel: true, referralCode: true },
    });
    const transactions = await this.prisma.loyaltyTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const lifetime = await this.prisma.order.aggregate({
      where: { userId, status: 'DELIVERED' },
      _sum: { total: true },
    });
    const lifetimeSpend = lifetime._sum.total ?? 0;

    const currentIdx = LEVEL_THRESHOLDS.findIndex((t) => t.level === user.loyaltyLevel);
    const nextTier = currentIdx > 0 ? LEVEL_THRESHOLDS[currentIdx - 1] : null;

    return {
      points: user.loyaltyPoints,
      level: user.loyaltyLevel,
      cashbackPercent: this.cashbackPercentFor(user.loyaltyLevel),
      lifetimeSpend,
      nextLevel: nextTier
        ? { level: nextTier.level, remaining: Math.max(0, nextTier.minLifetimeSpend - lifetimeSpend) }
        : null,
      transactions,
    };
  }

  async getReferralInfo(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { referralCode: true },
    });
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referredUser: { select: { firstName: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      referralCode: user.referralCode,
      bonusPerReferral: REFERRAL_BONUS_POINTS,
      invited: referrals.length,
      rewarded: referrals.filter((r) => r.rewardGranted).length,
      referrals: referrals.map((r) => ({
        firstName: r.referredUser.firstName,
        joinedAt: r.referredUser.createdAt,
        rewardGranted: r.rewardGranted,
      })),
    };
  }

  /**
   * Spends points at checkout.
   *
   * Returns the discount in kopecks (1 point = 1 ₽) together with the ledger
   * row it wrote. The caller links that row to the order once the order has
   * an id — which is what makes the spend refundable later, and what turns a
   * bare "−200" in the customer's history into "−200 for order #A1B2C3D4".
   */
  async redeemPoints(
    tx: Prisma.TransactionClient,
    userId: string,
    points: number,
    maxDiscount: number,
  ): Promise<{ discount: number; transactionId: string | null }> {
    if (points <= 0) return NOTHING_SPENT;

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const usable = Math.min(points, user.loyaltyPoints, Math.floor(maxDiscount / POINT_VALUE_KOPECKS));
    if (usable <= 0) return NOTHING_SPENT;

    // Conditional decrement: the balance was read a moment ago, and two
    // checkouts running at once would otherwise both spend the same points and
    // push the balance negative.
    const { count } = await tx.user.updateMany({
      where: { id: userId, loyaltyPoints: { gte: usable } },
      data: { loyaltyPoints: { decrement: usable } },
    });

    // Losing that race used to return 0, which let the order go through at
    // full price — the customer was charged more than the screen had just
    // quoted them, with nothing said. Refusing puts the choice back where it
    // belongs: they can reload and order without the points.
    if (count === 0) {
      throw new ConflictException('Баллы уже потрачены другим заказом — обновите страницу');
    }

    const transaction = await tx.loyaltyTransaction.create({
      data: { userId, points: -usable, type: LoyaltyTxType.REDEEM },
    });

    return { discount: usable * POINT_VALUE_KOPECKS, transactionId: transaction.id };
  }

  /**
   * Hands back the points an order was paid with, once that order is off.
   *
   * Reads the ledger rather than the order: the ledger is what the balance
   * was actually derived from, so refunding from it cannot drift from what
   * was really taken — and a double cancellation finds nothing left to give
   * back instead of minting points.
   */
  async refundForCancelledOrder(
    tx: Prisma.TransactionClient,
    userId: string,
    orderId: string,
  ): Promise<number> {
    const spends = await tx.loyaltyTransaction.findMany({
      where: { orderId, userId, type: LoyaltyTxType.REDEEM },
    });

    const alreadyRefunded = await tx.loyaltyTransaction.count({
      where: { orderId, userId, type: LoyaltyTxType.REFUND },
    });
    if (alreadyRefunded > 0) return 0;

    const points = spends.reduce((sum, row) => sum + Math.abs(row.points), 0);
    if (points === 0) return 0;

    await tx.user.update({ where: { id: userId }, data: { loyaltyPoints: { increment: points } } });
    await tx.loyaltyTransaction.create({
      data: { userId, orderId, points, type: LoyaltyTxType.REFUND },
    });

    return points;
  }
}
