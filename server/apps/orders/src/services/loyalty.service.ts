import { Injectable } from '@nestjs/common';
import { LoyaltyLevel, LoyaltyTxType, Prisma, PrismaService } from '@chicago-pizza/prisma';

/**
 * Loyalty rules:
 *  - Cashback rate depends on the customer's level.
 *  - The level is derived from lifetime spend, recomputed after each order.
 *  - Points are kopecks-equivalent: 1 point = 1 ₽ off a future order.
 */
const LEVEL_THRESHOLDS: { level: LoyaltyLevel; minLifetimeSpend: number; cashbackPercent: number }[] = [
  { level: LoyaltyLevel.GOLD, minLifetimeSpend: 3_000_00, cashbackPercent: 10 },
  { level: LoyaltyLevel.SILVER, minLifetimeSpend: 1_000_00, cashbackPercent: 7 },
  { level: LoyaltyLevel.BRONZE, minLifetimeSpend: 0, cashbackPercent: 5 },
];

const REFERRAL_BONUS_POINTS = 300;

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
   */
  async awardForOrder(tx: Prisma.TransactionClient, userId: string, orderId: string, orderTotal: number) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const points = Math.floor((orderTotal * this.cashbackPercentFor(user.loyaltyLevel)) / 100 / 100);

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
      data: { userId: referral.referrerId, points: REFERRAL_BONUS_POINTS, type: LoyaltyTxType.REFERRAL_BONUS },
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

  /** Spends points at checkout. Returns the discount in kopecks (1 point = 1 ₽). */
  async redeemPoints(tx: Prisma.TransactionClient, userId: string, points: number, maxDiscount: number) {
    if (points <= 0) return 0;

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const usable = Math.min(points, user.loyaltyPoints, Math.floor(maxDiscount / 100));
    if (usable <= 0) return 0;

    await tx.user.update({ where: { id: userId }, data: { loyaltyPoints: { decrement: usable } } });
    await tx.loyaltyTransaction.create({
      data: { userId, points: -usable, type: LoyaltyTxType.REDEEM },
    });

    return usable * 100;
  }
}
