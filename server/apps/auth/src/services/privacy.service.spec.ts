import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { of } from 'rxjs';
import { PrivacyService } from './privacy.service';

const NOW = new Date('2026-09-19T10:00:00.000Z');

function sessionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    tokenHash: 'hash-current',
    ip: '10.0.0.1',
    userAgent: 'Mozilla/5.0',
    createdAt: NOW,
    expiresAt: new Date('2026-10-19T10:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

function userFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'guest@chicago.ru',
    phone: '+79280000000',
    firstName: 'Амина',
    lastName: 'Магомедова',
    role: 'USER',
    locale: 'ru',
    referralCode: 'AABBCCDD',
    loyaltyPoints: 120,
    loyaltyLevel: 'SILVER',
    isEmailVerified: true,
    anonymizedAt: null,
    consentVersion: '2026-09-19',
    consentAcceptedAt: NOW,
    passwordHash: 'hashed',
    createdAt: NOW,
    addresses: [{ id: 'addr-1', street: 'пр. Имама Шамиля', house: '45' }],
    ...overrides,
  };
}

function createService(overrides: Record<string, any> = {}) {
  const prisma: Record<string, any> = {
    user: {
      findUnique: jest.fn(async () => userFixture()),
      update: jest.fn(async () => userFixture()),
      count: jest.fn(async () => 2),
    },
    refreshToken: {
      findMany: jest.fn(async () => [sessionFixture()]),
      findUnique: jest.fn(async () => sessionFixture()),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    address: { deleteMany: jest.fn(async () => ({ count: 1 })) },
    pushSubscription: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    notification: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    emailVerificationCode: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    passwordResetToken: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    favorite: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    adminAuditLog: { create: jest.fn(async () => ({ id: 'audit-1' })) },
    $transaction: jest.fn(async (operations: unknown[]) => operations),
    ...overrides,
  };

  const config = { get: jest.fn(() => '15m') };
  const tokens = { revokeAllForUser: jest.fn(async () => undefined) };
  const cache = {
    set: jest.fn(async () => undefined),
    del: jest.fn(async (..._keys: string[]) => undefined),
    client: { publish: jest.fn(async () => 1) },
  };
  const orders = { send: jest.fn(() => of({ orders: [] })) };
  const support = { send: jest.fn(() => of({ tickets: [] })) };

  const service = new PrivacyService(
    prisma as never,
    config as never,
    tokens as never,
    cache as never,
    orders as never,
    support as never,
  );

  return { service, prisma, tokens, cache, orders, support };
}

/**
 * `ip` and `userAgent` were written on every sign-in and shown to nobody —
 * data collected for a purpose no one could act on. This is that purpose.
 */
describe('PrivacyService — sessions', () => {
  it('lists only the sessions that are still live', async () => {
    const { service, prisma } = createService();

    await service.listSessions('user-1');

    expect(prisma.refreshToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1', revokedAt: null }),
      }),
    );
  });

  it('marks the session making the request so the UI can say "this device"', async () => {
    const { service } = createService();

    const [session] = await service.listSessions('user-1', 'hash-current');

    expect(session.isCurrent).toBe(true);
    expect(session.ip).toBe('10.0.0.1');
  });

  it('never returns the token itself, only what it was used from', async () => {
    const { service } = createService();

    const [session] = await service.listSessions('user-1', 'hash-current');

    expect(session).not.toHaveProperty('tokenHash');
  });

  it('ends another session', async () => {
    const { service, prisma } = createService();

    await expect(service.revokeSession('user-1', 'session-1', 'hash-other')).resolves.toEqual({
      success: true,
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('refuses to end the caller’s own session — that is what logout is for', async () => {
    const { service, prisma } = createService();

    await expect(service.revokeSession('user-1', 'session-1', 'hash-current')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('will not let one customer end another’s session', async () => {
    const { service, prisma } = createService({
      refreshToken: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => sessionFixture({ userId: 'someone-else' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    });

    // Reported as "not found" rather than "forbidden": confirming the id
    // exists would tell a stranger something about another account.
    await expect(service.revokeSession('user-1', 'session-1')).rejects.toThrow(NotFoundException);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});

describe('PrivacyService — export', () => {
  it('gathers the parts each service owns', async () => {
    const { service, orders, support } = createService();

    const dump = await service.exportData('user-1');

    expect(orders.send).toHaveBeenCalledWith('orders.export_data', { userId: 'user-1' });
    expect(support.send).toHaveBeenCalledWith('support.export_data', { userId: 'user-1' });
    expect(dump.orders).toEqual({ orders: [] });
    expect(dump.support).toEqual({ tickets: [] });
  });

  it('includes the profile, the addresses and what was consented to', async () => {
    const { service } = createService();

    const dump = await service.exportData('user-1');

    expect(dump.profile).toMatchObject({ email: 'guest@chicago.ru', phone: '+79280000000' });
    expect(dump.profile.consent).toEqual({ version: '2026-09-19', acceptedAt: NOW });
    expect(dump.addresses).toHaveLength(1);
  });

  it('leaves the password hash out', async () => {
    const { service } = createService();

    // An export is a copy of a person's data. The hash is ours, and a leaked
    // export file containing it is an offline cracking job.
    const dump = await service.exportData('user-1');

    expect(JSON.stringify(dump)).not.toContain('hashed');
  });

  it('refuses for an account that does not exist', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null as never);

    await expect(service.exportData('ghost')).rejects.toThrow(NotFoundException);
  });
});

/**
 * Withdrawal of consent has to be as available as giving it was. Orders are
 * accounting records and stay; the person behind them does not.
 */
describe('PrivacyService — erasure', () => {
  it('overwrites every field that names a person', async () => {
    const { service, prisma } = createService();

    await service.deleteAccount('user-1', '10.0.0.1');

    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data.email).toBe('deleted-user-1@deleted.invalid');
    expect(data.phone).toBeNull();
    expect(data.lastName).toBeNull();
    expect(data.firstName).not.toContain('Амина');
    expect(data.anonymizedAt).toBeInstanceOf(Date);
    // Consent is withdrawn, not merely marked as old.
    expect(data.consentVersion).toBeNull();
  });

  it('replaces the password with something nobody holds', async () => {
    const { service, prisma } = createService();

    await service.deleteAccount('user-1');

    const { data } = prisma.user.update.mock.calls[0][0];
    // An empty hash would make bcrypt.compare cheap and the account
    // technically reachable; random bytes are reachable by no one.
    expect(data.passwordHash).toMatch(/^[0-9a-f]{96}$/);
    expect(data.passwordHash).not.toBe('hashed');
  });

  it('deletes the rows that exist only to describe the customer', async () => {
    const { service, prisma } = createService();

    await service.deleteAccount('user-1');

    for (const delegate of ['address', 'pushSubscription', 'notification', 'favorite']) {
      expect(prisma[delegate].deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    }
  });

  it('asks the other domains to erase their own share', async () => {
    const { service, orders, support } = createService();

    await service.deleteAccount('user-1');

    expect(orders.send).toHaveBeenCalledWith('orders.anonymize_user', { userId: 'user-1' });
    expect(support.send).toHaveBeenCalledWith('support.anonymize_user', { userId: 'user-1' });
  });

  it('ends every session and clears the cart', async () => {
    const { service, tokens, cache } = createService();

    await service.deleteAccount('user-1');

    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
    // Live sockets too, not only the next request.
    expect(cache.client.publish).toHaveBeenCalledWith('auth:session-revoked', 'user-1');
    expect(cache.del).toHaveBeenCalledWith('cart:user-1');
  });

  it('records the erasure without an administrator behind it', async () => {
    const { service, prisma } = createService();

    await service.deleteAccount('user-1', '10.0.0.1');

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ACCOUNT_ERASED',
        actorId: null,
        targetType: 'user',
        targetId: 'user-1',
        ip: '10.0.0.1',
      }),
    });
  });

  it('is idempotent — a second request is not an error', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ anonymizedAt: NOW }) as never);

    await expect(service.deleteAccount('user-1')).resolves.toEqual({ success: true });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses to erase the last administrator', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ role: 'ADMIN' }) as never);
    prisma.user.count.mockResolvedValue(1 as never);

    // Nobody would be left able to run the shop, and no admin panel could
    // hand the rights back.
    await expect(service.deleteAccount('user-1')).rejects.toThrow(ForbiddenException);
  });

  it('lets an administrator go when another one remains', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ role: 'ADMIN' }) as never);
    prisma.user.count.mockResolvedValue(2 as never);

    await expect(service.deleteAccount('user-1')).resolves.toEqual({ success: true });
  });
});
