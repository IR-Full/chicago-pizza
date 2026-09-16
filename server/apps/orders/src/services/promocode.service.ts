import { BadRequestException, Injectable } from '@nestjs/common';
import { DiscountType, PrismaService } from '@chicago-pizza/prisma';

export interface AppliedPromocode {
  promocodeId: string;
  code: string;
  discount: number;
}

@Injectable()
export class PromocodeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates a promocode against the current subtotal and returns the
   * discount in kopecks. Never returns a discount larger than the subtotal.
   */
  async validate(code: string, subtotal: number): Promise<AppliedPromocode> {
    const promocode = await this.prisma.promocode.findUnique({ where: { code: code.toUpperCase() } });

    if (!promocode || !promocode.isActive) throw new BadRequestException('Промокод не найден');
    if (promocode.expiresAt && promocode.expiresAt < new Date()) throw new BadRequestException('Промокод истёк');
    if (promocode.maxUses !== null && promocode.usedCount >= promocode.maxUses) {
      throw new BadRequestException('Промокод больше не действует');
    }
    if (subtotal < promocode.minOrderAmount) {
      throw new BadRequestException(
        `Минимальная сумма заказа для этого промокода — ${Math.round(promocode.minOrderAmount / 100)} ₽`,
      );
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

  incrementUsage(promocodeId: string) {
    return this.prisma.promocode.update({
      where: { id: promocodeId },
      data: { usedCount: { increment: 1 } },
    });
  }

  list() {
    return this.prisma.promocode.findMany({ orderBy: { createdAt: 'desc' } });
  }

  create(data: {
    code: string;
    discountType: DiscountType;
    discountValue: number;
    minOrderAmount?: number;
    maxUses?: number;
    expiresAt?: Date;
  }) {
    return this.prisma.promocode.create({ data: { ...data, code: data.code.toUpperCase() } });
  }
}
