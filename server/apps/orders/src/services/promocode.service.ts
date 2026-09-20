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

    await tx.promocodeRedemption.create({ data: { promocodeId, userId, orderId } });
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
