import { BadRequestException } from '@nestjs/common';
import { PromocodeService } from './promocode.service';

function createPrismaMock(promocode: Record<string, unknown> | null) {
  return {
    promocode: {
      findUnique: jest.fn(() => promocode),
      update: jest.fn(),
    },
  };
}

const basePromocode = {
  id: 'promo-1',
  code: 'WELCOME10',
  discountType: 'PERCENT',
  discountValue: 10,
  minOrderAmount: 50000,
  maxUses: 100,
  usedCount: 0,
  isActive: true,
  expiresAt: null,
};

describe('PromocodeService', () => {
  it('computes a percentage discount', async () => {
    const service = new PromocodeService(createPrismaMock(basePromocode) as never);

    const result = await service.validate('WELCOME10', 100000);

    expect(result.discount).toBe(10000);
    expect(result.code).toBe('WELCOME10');
  });

  it('computes a fixed discount', async () => {
    const service = new PromocodeService(
      createPrismaMock({ ...basePromocode, discountType: 'FIXED', discountValue: 20000 }) as never,
    );

    await expect(service.validate('WELCOME10', 100000)).resolves.toMatchObject({ discount: 20000 });
  });

  it('never discounts more than the subtotal', async () => {
    const service = new PromocodeService(
      createPrismaMock({
        ...basePromocode,
        discountType: 'FIXED',
        discountValue: 500000,
        minOrderAmount: 0,
      }) as never,
    );

    // A 5000 ₽ fixed code against a 600 ₽ cart must not produce a negative total.
    await expect(service.validate('WELCOME10', 60000)).resolves.toMatchObject({ discount: 60000 });
  });

  it('is case-insensitive on the code', async () => {
    const prisma = createPrismaMock(basePromocode);
    const service = new PromocodeService(prisma as never);

    await service.validate('welcome10', 100000);

    expect(prisma.promocode.findUnique).toHaveBeenCalledWith({ where: { code: 'WELCOME10' } });
  });

  it('rejects an unknown code', async () => {
    const service = new PromocodeService(createPrismaMock(null) as never);

    await expect(service.validate('NOPE', 100000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a deactivated code', async () => {
    const service = new PromocodeService(createPrismaMock({ ...basePromocode, isActive: false }) as never);

    await expect(service.validate('WELCOME10', 100000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired code', async () => {
    const service = new PromocodeService(
      createPrismaMock({ ...basePromocode, expiresAt: new Date('2020-01-01') }) as never,
    );

    await expect(service.validate('WELCOME10', 100000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a code that hit its usage limit', async () => {
    const service = new PromocodeService(
      createPrismaMock({ ...basePromocode, maxUses: 5, usedCount: 5 }) as never,
    );

    await expect(service.validate('WELCOME10', 100000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a cart below the minimum order amount', async () => {
    const service = new PromocodeService(createPrismaMock(basePromocode) as never);

    await expect(service.validate('WELCOME10', 40000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows unlimited codes (maxUses = null)', async () => {
    const service = new PromocodeService(
      createPrismaMock({ ...basePromocode, maxUses: null, usedCount: 9999 }) as never,
    );

    await expect(service.validate('WELCOME10', 100000)).resolves.toMatchObject({ discount: 10000 });
  });

  it('looks the code up case-insensitively', async () => {
    const prisma = createPrismaMock(basePromocode);
    const service = new PromocodeService(prisma as never);

    await service.validate('welcome10', 100000);

    expect(prisma.promocode.findUnique).toHaveBeenCalledWith({ where: { code: 'WELCOME10' } });
  });

  describe('administration', () => {
    function adminPrisma() {
      return {
        promocode: {
          findUnique: jest.fn(),
          findMany: jest.fn(async () => [basePromocode]),
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'promo-2', ...data })),
          update: jest.fn(async () => ({ ...basePromocode, usedCount: 1 })),
        },
      };
    }

    it('lists promocodes newest first', async () => {
      const prisma = adminPrisma();

      await new PromocodeService(prisma as never).list();

      expect(prisma.promocode.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
    });

    it('stores a new code uppercased', async () => {
      const prisma = adminPrisma();

      await new PromocodeService(prisma as never).create({
        code: 'chicago10',
        discountType: 'PERCENT' as never,
        discountValue: 10,
      });

      // `validate` uppercases before lookup, so storage must match.
      expect(prisma.promocode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ code: 'CHICAGO10', discountValue: 10 }),
      });
    });

    it('keeps the optional limits it was given', async () => {
      const prisma = adminPrisma();
      const expiresAt = new Date('2026-12-31T20:59:00.000Z');

      await new PromocodeService(prisma as never).create({
        code: 'NY2027',
        discountType: 'FIXED' as never,
        discountValue: 20_000,
        minOrderAmount: 100_000,
        maxUses: 50,
        expiresAt,
      });

      expect(prisma.promocode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ minOrderAmount: 100_000, maxUses: 50, expiresAt }),
      });
    });

    it('books a usage against the code', async () => {
      const prisma = adminPrisma();

      await new PromocodeService(prisma as never).incrementUsage('promo-1');

      expect(prisma.promocode.update).toHaveBeenCalledWith({
        where: { id: 'promo-1' },
        data: { usedCount: { increment: 1 } },
      });
    });
  });
});
