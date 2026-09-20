import { BadRequestException } from '@nestjs/common';
import { PromocodeService } from './promocode.service';

function createPrismaMock(promocode: Record<string, unknown> | null, redemptionsByUser = 0) {
  return {
    promocode: {
      findUnique: jest.fn(() => promocode),
      update: jest.fn(),
    },
    // The per-customer limit is counted from the redemption ledger.
    promocodeRedemption: {
      count: jest.fn(async () => redemptionsByUser),
      create: jest.fn(async () => ({ id: 'redemption-1' })),
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
  perUserLimit: null,
  isActive: true,
  expiresAt: null,
};

/** The audit trail is written on creation; it must never fail the action. */
const auditMock = () => ({ record: jest.fn(async () => undefined) }) as never;

describe('PromocodeService', () => {
  it('computes a percentage discount', async () => {
    const service = new PromocodeService(createPrismaMock(basePromocode) as never, auditMock());

    const result = await service.validate('WELCOME10', 100000);

    expect(result.discount).toBe(10000);
    expect(result.code).toBe('WELCOME10');
  });

  it('computes a fixed discount', async () => {
    const service = new PromocodeService(
      createPrismaMock({ ...basePromocode, discountType: 'FIXED', discountValue: 20000 }) as never,
      auditMock(),
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
      auditMock(),
    );

    // A 5000 ₽ fixed code against a 600 ₽ cart must not produce a negative total.
    await expect(service.validate('WELCOME10', 60000)).resolves.toMatchObject({ discount: 60000 });
  });

  it('is case-insensitive on the code', async () => {
    const prisma = createPrismaMock(basePromocode);
    const service = new PromocodeService(prisma as never, auditMock());

    await service.validate('welcome10', 100000);

    expect(prisma.promocode.findUnique).toHaveBeenCalledWith({ where: { code: 'WELCOME10' } });
  });

  it('rejects an unknown code', async () => {
    const service = new PromocodeService(createPrismaMock(null) as never, auditMock());

    await expect(service.validate('NOPE', 100000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a deactivated code', async () => {
    const service = new PromocodeService(createPrismaMock({ ...basePromocode, isActive: false }) as never, auditMock());

    await expect(service.validate('WELCOME10', 100000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired code', async () => {
    const service = new PromocodeService(
      createPrismaMock({ ...basePromocode, expiresAt: new Date('2020-01-01') }) as never,
      auditMock(),
    );

    await expect(service.validate('WELCOME10', 100000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a code that hit its usage limit', async () => {
    const service = new PromocodeService(
      createPrismaMock({ ...basePromocode, maxUses: 5, usedCount: 5 }) as never,
      auditMock(),
    );

    await expect(service.validate('WELCOME10', 100000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a cart below the minimum order amount', async () => {
    const service = new PromocodeService(createPrismaMock(basePromocode) as never, auditMock());

    await expect(service.validate('WELCOME10', 40000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows unlimited codes (maxUses = null)', async () => {
    const service = new PromocodeService(
      createPrismaMock({ ...basePromocode, maxUses: null, usedCount: 9999 }) as never,
      auditMock(),
    );

    await expect(service.validate('WELCOME10', 100000)).resolves.toMatchObject({ discount: 10000 });
  });

  it('looks the code up case-insensitively', async () => {
    const prisma = createPrismaMock(basePromocode);
    const service = new PromocodeService(prisma as never, auditMock());

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

      await new PromocodeService(prisma as never, auditMock()).list();

      expect(prisma.promocode.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
    });

    it('stores a new code uppercased', async () => {
      const prisma = adminPrisma();

      await new PromocodeService(prisma as never, auditMock()).create({
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

      await new PromocodeService(prisma as never, auditMock()).create({
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

    it('records who issued the code and on what terms', async () => {
      const prisma = adminPrisma();
      const audit = { record: jest.fn(async () => undefined) };

      await new PromocodeService(prisma as never, audit as never).create(
        { code: 'chicago10', discountType: 'PERCENT' as never, discountValue: 10, maxUses: 50 },
        'admin-1',
      );

      // A code is money given away; "who authorised this" needs an answer.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PROMOCODE_CREATED',
          actorId: 'admin-1',
          targetType: 'promocode',
          details: expect.objectContaining({ code: 'CHICAGO10', maxUses: 50 }),
        }),
      );
    });
  });
});

/**
 * Booking a use is conditional on purpose: `validate()` reads `usedCount`
 * before the checkout transaction opens, so two simultaneous orders could
 * both see the last remaining use of a code.
 */
describe('PromocodeService — redeeming', () => {
  function txMock(updatedCount: number) {
    return {
      promocode: {
        updateMany: jest.fn(async () => ({ count: updatedCount })),
        fields: { maxUses: 'maxUses' },
      },
      promocodeRedemption: { create: jest.fn(async () => ({ id: 'redemption-1' })) },
    };
  }

  it('increments the counter only while uses remain, and writes the ledger row', async () => {
    const tx = txMock(1);

    await new PromocodeService({} as never, auditMock()).redeem(tx as never, 'promo-1', 'user-1', 'order-1');

    expect(tx.promocode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { usedCount: { increment: 1 } } }),
    );
    expect(tx.promocodeRedemption.create).toHaveBeenCalledWith({
      data: { promocodeId: 'promo-1', userId: 'user-1', orderId: 'order-1' },
    });
  });

  it('refuses the checkout that lost the race for the last use', async () => {
    const tx = txMock(0);

    await expect(
      new PromocodeService({} as never, auditMock()).redeem(tx as never, 'promo-1', 'user-1', 'order-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // No ledger row for an order that was never discounted.
    expect(tx.promocodeRedemption.create).not.toHaveBeenCalled();
  });
});

describe('PromocodeService — per-customer limit', () => {
  const oncePerCustomer = { ...basePromocode, perUserLimit: 1 };

  it('refuses a code the customer has already used', async () => {
    const service = new PromocodeService(createPrismaMock(oncePerCustomer, 1) as never, auditMock());

    // `usedCount` counts uses across everyone, so without this a
    // "first order" code worked forever, for every customer.
    await expect(service.validate('WELCOME10', 100000, 'user-1')).rejects.toThrow(/уже использовали/);
  });

  it('allows it for a customer who has not', async () => {
    const service = new PromocodeService(createPrismaMock(oncePerCustomer, 0) as never, auditMock());

    await expect(service.validate('WELCOME10', 100000, 'user-1')).resolves.toMatchObject({
      discount: 10000,
    });
  });

  it('skips the check when no customer is named — the cart preview', async () => {
    const prisma = createPrismaMock(oncePerCustomer, 5);
    const service = new PromocodeService(prisma as never, auditMock());

    await expect(service.validate('WELCOME10', 100000)).resolves.toMatchObject({ discount: 10000 });
    expect(prisma.promocodeRedemption.count).not.toHaveBeenCalled();
  });
});
