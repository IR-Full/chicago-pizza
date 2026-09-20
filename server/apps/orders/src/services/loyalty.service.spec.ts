import { LoyaltyService } from './loyalty.service';

/**
 * Money-adjacent rules: cashback percentages, level thresholds and point
 * redemption. Every branch here changes what a customer pays.
 */
function createService(overrides: Record<string, any> = {}) {
  const tx: Record<string, any> = {
    user: {
      findUniqueOrThrow: jest.fn(async () => ({ id: 'user-1', loyaltyLevel: 'BRONZE', loyaltyPoints: 1000 })),
      update: jest.fn(async () => ({})),
      // Spending is a conditional update: it only succeeds while the balance
      // still covers the amount.
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    order: {
      aggregate: jest.fn(async () => ({ _sum: { total: 0 } })),
      update: jest.fn(async () => ({})),
    },
    loyaltyTransaction: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
    referral: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
    ...overrides,
  };

  return { service: new LoyaltyService(tx as never), tx };
}

describe('LoyaltyService — rates and levels', () => {
  it.each([
    ['BRONZE', 5],
    ['SILVER', 7],
    ['GOLD', 10],
  ])('gives %s customers %s%% cashback', (level, percent) => {
    const { service } = createService();

    expect(service.cashbackPercentFor(level as never)).toBe(percent);
  });

  it.each([
    [0, 'BRONZE'],
    [99_99, 'BRONZE'],
    [1_000_00, 'SILVER'],
    [2_999_99, 'SILVER'],
    [3_000_00, 'GOLD'],
    [10_000_00, 'GOLD'],
  ])('lifetime spend of %s kopecks maps to %s', (spend, level) => {
    const { service } = createService();

    expect(service.levelFor(spend)).toBe(level);
  });
});

describe('LoyaltyService — awardForOrder', () => {
  it('awards whole points at the customer’s rate', async () => {
    const { service, tx } = createService();

    // 5% of 1000 ₽ = 50 ₽ = 50 points.
    const result = await service.awardForOrder(tx as never, 'user-1', 'order-1', 100_000);

    expect(result.points).toBe(50);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { loyaltyPoints: { increment: 50 }, loyaltyLevel: 'BRONZE' },
    });
  });

  it('rounds fractional points down', async () => {
    const { service, tx } = createService();

    const result = await service.awardForOrder(tx as never, 'user-1', 'order-1', 19_99);

    expect(result.points).toBe(0);
  });

  it('uses the gold rate for a gold customer', async () => {
    const { service, tx } = createService();
    tx.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', loyaltyLevel: 'GOLD', loyaltyPoints: 0 });

    await expect(service.awardForOrder(tx as never, 'user-1', 'order-1', 100_000)).resolves.toMatchObject({
      points: 100,
    });
  });

  it('promotes the customer once lifetime spend crosses a threshold', async () => {
    const { service, tx } = createService();
    tx.order.aggregate.mockResolvedValue({ _sum: { total: 3_000_00 } });

    const result = await service.awardForOrder(tx as never, 'user-1', 'order-1', 100_000);

    expect(result.newLevel).toBe('GOLD');
    expect(tx.user.update.mock.calls[0][0].data.loyaltyLevel).toBe('GOLD');
  });

  it('counts only delivered orders towards the level', async () => {
    const { service, tx } = createService();

    await service.awardForOrder(tx as never, 'user-1', 'order-1', 100_000);

    expect(tx.order.aggregate).toHaveBeenCalledWith({
      where: { userId: 'user-1', status: 'DELIVERED' },
      _sum: { total: true },
    });
  });

  it('treats a customer with no delivered orders as bronze', async () => {
    const { service, tx } = createService();
    tx.order.aggregate.mockResolvedValue({ _sum: { total: null } });

    await expect(service.awardForOrder(tx as never, 'user-1', 'order-1', 100_000)).resolves.toMatchObject({
      newLevel: 'BRONZE',
    });
  });

  it('writes a ledger entry and stamps the order', async () => {
    const { service, tx } = createService();

    await service.awardForOrder(tx as never, 'user-1', 'order-1', 100_000);

    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', orderId: 'order-1', points: 50, type: 'EARN' },
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { loyaltyPointsEarned: 50 },
    });
  });
});

describe('LoyaltyService — settleReferral', () => {
  it('does nothing when the customer was not referred', async () => {
    const { service, tx } = createService();

    await expect(service.settleReferral(tx as never, 'user-2')).resolves.toBeNull();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('pays the referrer exactly once', async () => {
    const { service, tx } = createService();
    tx.referral.findUnique.mockResolvedValue({ id: 'ref-1', referrerId: 'user-9', rewardGranted: false });

    const result = await service.settleReferral(tx as never, 'user-2');

    expect(result).toEqual({ referrerId: 'user-9', points: 300 });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-9' },
      data: { loyaltyPoints: { increment: 300 } },
    });
    expect(tx.referral.update).toHaveBeenCalledWith({ where: { id: 'ref-1' }, data: { rewardGranted: true } });
  });

  it('refuses to pay a second time for the same referral', async () => {
    const { service, tx } = createService();
    tx.referral.findUnique.mockResolvedValue({ id: 'ref-1', referrerId: 'user-9', rewardGranted: true });

    await expect(service.settleReferral(tx as never, 'user-2')).resolves.toBeNull();
    expect(tx.loyaltyTransaction.create).not.toHaveBeenCalled();
  });
});

describe('LoyaltyService — getSummary', () => {
  it('reports points, level and rate', async () => {
    const { service, tx } = createService();
    tx.user.findUniqueOrThrow.mockResolvedValue({
      loyaltyPoints: 420,
      loyaltyLevel: 'SILVER',
      referralCode: 'AABBCCDD',
    });
    tx.order.aggregate.mockResolvedValue({ _sum: { total: 1_500_00 } });

    await expect(service.getSummary('user-1')).resolves.toMatchObject({
      points: 420,
      level: 'SILVER',
      cashbackPercent: 7,
      lifetimeSpend: 1_500_00,
    });
  });

  it('shows how much is left to reach the next level', async () => {
    const { service, tx } = createService();
    tx.user.findUniqueOrThrow.mockResolvedValue({ loyaltyPoints: 0, loyaltyLevel: 'SILVER', referralCode: 'X' });
    tx.order.aggregate.mockResolvedValue({ _sum: { total: 1_500_00 } });

    await expect(service.getSummary('user-1')).resolves.toMatchObject({
      nextLevel: { level: 'GOLD', remaining: 1_500_00 },
    });
  });

  it('never reports a negative remainder', async () => {
    const { service, tx } = createService();
    tx.user.findUniqueOrThrow.mockResolvedValue({ loyaltyPoints: 0, loyaltyLevel: 'SILVER', referralCode: 'X' });
    tx.order.aggregate.mockResolvedValue({ _sum: { total: 5_000_00 } });

    await expect(service.getSummary('user-1')).resolves.toMatchObject({
      nextLevel: { level: 'GOLD', remaining: 0 },
    });
  });

  it('has no next level at the top tier', async () => {
    const { service, tx } = createService();
    tx.user.findUniqueOrThrow.mockResolvedValue({ loyaltyPoints: 0, loyaltyLevel: 'GOLD', referralCode: 'X' });

    await expect(service.getSummary('user-1')).resolves.toMatchObject({ nextLevel: null });
  });

  it('returns the fifty most recent ledger entries', async () => {
    const { service, tx } = createService();

    await service.getSummary('user-1');

    expect(tx.loyaltyTransaction.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });

  it('treats no delivered orders as zero lifetime spend', async () => {
    const { service, tx } = createService();
    tx.order.aggregate.mockResolvedValue({ _sum: { total: null } });

    await expect(service.getSummary('user-1')).resolves.toMatchObject({ lifetimeSpend: 0 });
  });
});

describe('LoyaltyService — getReferralInfo', () => {
  it('summarises invitations and rewards', async () => {
    const { service, tx } = createService();
    tx.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'AABBCCDD' });
    tx.referral.findMany.mockResolvedValue([
      { rewardGranted: true, referredUser: { firstName: 'Амина', createdAt: new Date('2026-02-01') } },
      { rewardGranted: false, referredUser: { firstName: 'Марат', createdAt: new Date('2026-03-01') } },
    ]);

    await expect(service.getReferralInfo('user-1')).resolves.toMatchObject({
      referralCode: 'AABBCCDD',
      bonusPerReferral: 300,
      invited: 2,
      rewarded: 1,
    });
  });

  it('flattens each invitee to name, join date and status', async () => {
    const { service, tx } = createService();
    tx.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'X' });
    tx.referral.findMany.mockResolvedValue([
      { rewardGranted: true, referredUser: { firstName: 'Амина', createdAt: new Date('2026-02-01') } },
    ]);

    const info = await service.getReferralInfo('user-1');

    expect(info.referrals).toEqual([
      { firstName: 'Амина', joinedAt: new Date('2026-02-01'), rewardGranted: true },
    ]);
  });

  it('reports zeros for someone who invited nobody', async () => {
    const { service, tx } = createService();
    tx.user.findUniqueOrThrow.mockResolvedValue({ referralCode: 'X' });

    await expect(service.getReferralInfo('user-1')).resolves.toMatchObject({ invited: 0, rewarded: 0, referrals: [] });
  });
});

describe('LoyaltyService — redeemPoints', () => {
  it('converts points to a kopeck discount', async () => {
    const { service, tx } = createService();

    // 200 points = 200 ₽ = 20000 kopecks.
    await expect(service.redeemPoints(tx as never, 'user-1', 200, 100_000)).resolves.toBe(20_000);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', loyaltyPoints: { gte: 200 } },
      data: { loyaltyPoints: { decrement: 200 } },
    });
  });

  it.each([[0], [-5]])('spends nothing for %i points', async (points) => {
    const { service, tx } = createService();

    await expect(service.redeemPoints(tx as never, 'user-1', points, 100_000)).resolves.toBe(0);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('cannot spend more points than the customer owns', async () => {
    const { service, tx } = createService();
    tx.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', loyaltyPoints: 30 });

    await expect(service.redeemPoints(tx as never, 'user-1', 500, 100_000)).resolves.toBe(3_000);
  });

  it('cannot discount more than the order allows', async () => {
    const { service, tx } = createService();

    // The cap is 500 ₽ worth of the order, even though 1000 points are held.
    await expect(service.redeemPoints(tx as never, 'user-1', 1000, 50_000)).resolves.toBe(50_000);
  });

  it('spends nothing when the order is too small to absorb a point', async () => {
    const { service, tx } = createService();

    await expect(service.redeemPoints(tx as never, 'user-1', 100, 99)).resolves.toBe(0);
    expect(tx.loyaltyTransaction.create).not.toHaveBeenCalled();
  });

  it('spends nothing when a parallel checkout emptied the balance first', async () => {
    const { service, tx } = createService();
    tx.user.updateMany.mockResolvedValue({ count: 0 });

    // Read-then-write let two checkouts spend the same points and push the
    // balance negative; the conditional update is what prevents it.
    await expect(service.redeemPoints(tx as never, 'user-1', 200, 100_000)).resolves.toBe(0);
    expect(tx.loyaltyTransaction.create).not.toHaveBeenCalled();
  });

  it('records the spend as a negative ledger entry', async () => {
    const { service, tx } = createService();

    await service.redeemPoints(tx as never, 'user-1', 200, 100_000);

    expect(tx.loyaltyTransaction.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', points: -200, type: 'REDEEM' },
    });
  });
});
