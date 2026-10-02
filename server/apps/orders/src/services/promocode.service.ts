import { BadRequestException, Injectable } from '@nestjs/common';
import { AdminAction, DiscountType, Prisma, PrismaService } from '@chicago-pizza/prisma';
import { AuditService, kopecksToRubles } from '@chicago-pizza/common';

export interface AppliedPromocode {
  promocodeId: string;
  code: string;
  discount: number;
}

@Injectable()
export class PromocodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Validates a promocode against the current subtotal and returns the
   * discount in kopecks. Never returns a discount larger than the subtotal.
   *
   * `userId` is optional so the cart preview can quote a discount for a code
   * before checkout; when it is given, the per-customer limit is enforced too.
   */
  async validate(code: string, subtotal: number, userId?: string): Promise<AppliedPromocode> {
    const promocode = await this.prisma.promocode.findUnique({ where: { code: code.toUpperCase() } });

    if (!promocode || !promocode.isActive) throw new BadRequestException('Промокод не найден');
    if (promocode.expiresAt && promocode.expiresAt < new Date()) throw new BadRequestException('Промокод истёк');
    if (promocode.maxUses !== null && promocode.usedCount >= promocode.maxUses) {
      throw new BadRequestException('Промокод больше не действует');
    }
    if (subtotal < promocode.minOrderAmount) {
      throw new BadRequestException(
        `Минимальная сумма заказа для этого промокода — ${kopecksToRubles(promocode.minOrderAmount)} ₽`,
      );
    }

    // Without this a "−10% на первый заказ" code worked forever for every
    // customer: `usedCount` counts uses across all of them, not per account.
    if (userId && promocode.perUserLimit !== null) {
      const used = await this.prisma.promocodeRedemption.count({
        where: { promocodeId: promocode.id, userId },
      });
      if (used >= promocode.perUserLimit) {
        throw new BadRequestException('Вы уже использовали этот промокод');
      }
    }

    const raw =
      promocode.discountType === DiscountType.PERCENT
        ? Math.floor((subtotal * promocode.discountValue) / 100)
        : promocode.discountValue;

    return {
      promocodeId: promocode.id,
      code: promocode.code,
      discount: Math.min(raw, subtotal),
    };
  }

  /**
   * Books one use of a promocode inside the checkout transaction.
   *
   * The increment is conditional: `validate()` read `usedCount` before the
   * transaction started, so two simultaneous checkouts could both see the last
   * remaining use. Whoever loses the update gets a clear refusal instead of a
   * silently over-issued discount.
   */
  async redeem(
    tx: Prisma.TransactionClient,
    promocodeId: string,
    userId: string,
    orderId: string,
  ): Promise<void> {
    const { count } = await tx.promocode.updateMany({
      where: {
        id: promocodeId,
        isActive: true,
        OR: [{ maxUses: null }, { usedCount: { lt: tx.promocode.fields.maxUses } }],
      },
      data: { usedCount: { increment: 1 } },
    });

    if (count === 0) throw new BadRequestException('Промокод больше не действует');

    // The per-customer limit has to be re-checked *here*, after the update
    // above has taken the promocode's row lock.
    //
    // `validate()` counts redemptions too, but it runs before the transaction
    // opens, so two checkouts fired at the same moment both read "used 0 of
    // 1" and both went through — a "−10% на первый заказ" code paid out
    // twice to the same account. The lock serialises them; the second one
    // then sees the first one's committed row and is refused.
    //
    // A unique index would be the cheaper guard, but it cannot express this
    // rule: `perUserLimit` is configurable per code and may be any number, or
    // null for "as often as you like".
    const promocode = await tx.promocode.findUniqueOrThrow({
      where: { id: promocodeId },
      select: { perUserLimit: true },
    });

    if (promocode.perUserLimit !== null) {
      const used = await tx.promocodeRedemption.count({ where: { promocodeId, userId } });
      if (used >= promocode.perUserLimit) {
        throw new BadRequestException('Вы уже использовали этот промокод');
      }
    }

    await tx.promocodeRedemption.create({ data: { promocodeId, userId, orderId } });
  }

  /**
   * Unbooks a use when the order it was booked for is cancelled.
   *
   * Without this a customer who cancels loses the code: the redemption row
   * still counts against their personal limit, and `usedCount` still counts
   * against the global one — a discount consumed by an order that never
   * happened.
   */
  async release(tx: Prisma.TransactionClient, promocodeId: string, orderId: string): Promise<void> {
    const { count } = await tx.promocodeRedemption.deleteMany({ where: { orderId } });
    // Nothing was booked (or it was already released) — do not hand back a
    // use that was never taken.
    if (count === 0) return;

    await tx.promocode.updateMany({
      where: { id: promocodeId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
  }

  list() {
    return this.prisma.promocode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(
    data: {
      code: string;
      discountType: DiscountType;
      discountValue: number;
      minOrderAmount?: number;
      maxUses?: number;
      perUserLimit?: number | null;
      expiresAt?: Date;
    },
    actorId?: string,
  ) {
    // A percentage over 100 would not pay money out — `validate` clamps the
    // discount to the subtotal — it would make every qualifying order free.
    // That is a typo an owner can make at midnight and discover from the
    // morning's revenue, so it is refused at the point the number is entered.
    // The rule lives here rather than in the DTO because the bound depends on
    // `discountType`, and a validation class cannot condition one decorator on
    // another field without a custom constraint.
    if (data.discountType === DiscountType.PERCENT && data.discountValue > 100) {
      throw new BadRequestException('Процент скидки не может быть больше 100');
    }

    const promocode = await this.prisma.promocode.create({
      data: { ...data, code: data.code.toUpperCase() },
    });

    // A code is money given away; who issued it and on what terms is worth
    // being able to answer.
    await this.audit.record({
      action: AdminAction.PROMOCODE_CREATED,
      actorId: actorId ?? null,
      targetType: 'promocode',
      targetId: promocode.id,
      details: {
        code: promocode.code,
        discountType: promocode.discountType,
        discountValue: promocode.discountValue,
        maxUses: promocode.maxUses,
      },
    });

    return promocode;
  }
}
