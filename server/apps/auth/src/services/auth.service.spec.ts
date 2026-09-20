import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';

// Real bcrypt would add seconds per test for no extra confidence; the shape of
// the calls is what matters here.
jest.mock('bcrypt', () => ({
  hash: jest.fn(async (value: string, rounds: number) => `hashed:${value}:${rounds}`),
  compare: jest.fn(async (value: string, hash: string) => hash === `hashed:${value}:10`),
}));

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const CONFIG: Record<string, number | string> = {
  BCRYPT_SALT_ROUNDS: 10,
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCKOUT_MINUTES: 15,
  JWT_ACCESS_TTL: '15m',
};

function userFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'guest@chicago.ru',
    phone: '+79280000000',
    passwordHash: 'hashed:Password1:10',
    firstName: 'Амина',
    lastName: null,
    role: 'USER',
    isEmailVerified: false,
    isBlocked: false,
    loyaltyPoints: 0,
    loyaltyLevel: 'BRONZE',
    referralCode: 'AABBCCDD',
    darkThemeEnabled: false,
    locale: 'ru',
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    ...overrides,
  };
}

function createService(overrides: Record<string, any> = {}) {
  // Typed loosely on purpose: every delegate here is re-stubbed per test.
  const prisma: Record<string, any> = {
    user: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => userFixture(data)),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => userFixture(data)),
      findMany: jest.fn(async () => [userFixture()]),
      count: jest.fn(async () => 1),
    },
    referral: { create: jest.fn(async () => ({ id: 'ref-1' })) },
    emailVerificationCode: {
      create: jest.fn(async () => ({ id: 'code-1' })),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({ id: 'code-1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    passwordResetToken: {
      create: jest.fn(async () => ({ id: 'reset-1' })),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({ id: 'reset-1' })),
    },
    $transaction: jest.fn(async (operations: unknown[]) => operations),
    ...overrides,
  };

  const config = { get: jest.fn((key: string) => CONFIG[key]) };
  const tokens = {
    issueTokenPair: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })),
    rotate: jest.fn(async () => ({ accessToken: 'a2', refreshToken: 'r2' })),
    revoke: jest.fn(async () => undefined),
    revokeAllForUser: jest.fn(async () => undefined),
  };
  const cache = {
    // Typed with their parameters so tests can key stubs on the Redis key.
    get: jest.fn(async (_key: string): Promise<unknown> => null),
    set: jest.fn(async () => undefined),
    del: jest.fn(async (..._keys: string[]) => undefined),
    incrWithTtl: jest.fn(async (_key: string, _ttlSeconds: number) => 1),
    // Session revocation publishes on this channel so gateways can drop
    // the user's live sockets instead of waiting for the token to expire.
    client: { publish: jest.fn(async () => 1) },
  };
  const notifications = { emit: jest.fn() };
  // Privileged actions are recorded; the trail must not be able to fail them.
  const audit = { record: jest.fn(async () => undefined) };

  const service = new AuthService(
    prisma as never,
    config as never,
    tokens as never,
    cache as never,
    audit as never,
    notifications as never,
  );

  return { service, prisma, config, tokens, cache, audit, notifications };
}

const REGISTER_DTO = {
  email: 'Guest@Chicago.RU',
  password: 'Password1',
  firstName: 'Амина',
  lastName: 'Магомедова',
  phone: '+79280000000',
};

/**
 * `register` deliberately answers the same way whether or not the address is
 * already taken — the form used to be a membership oracle for any address an
 * attacker cared to type in.
 */
describe('AuthService — registration', () => {
  /** The email/phone probes and the referral lookup all go through findUnique. */
  const findUniqueBy = (prisma: Record<string, any>, matcher: (where: any) => unknown) =>
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: any }) => matcher(where) ?? null);

  it('answers a taken address exactly as it answers a fresh one', async () => {
    const { service, prisma } = createService();
    findUniqueBy(prisma, (where) => (where.email ? userFixture() : null));

    await expect(service.register(REGISTER_DTO as never)).resolves.toEqual({ status: 'verification_sent' });
    // No account, and above all no distinguishable error.
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('tells the owner of the address instead of the caller', async () => {
    const { service, prisma, notifications } = createService();
    findUniqueBy(prisma, (where) => (where.email ? userFixture() : null));

    await service.register(REGISTER_DTO as never);

    expect(notifications.emit).toHaveBeenCalledWith('auth.registration_attempted', {
      userId: 'user-1',
      email: 'guest@chicago.ru',
      firstName: 'Амина',
    });
    // Nothing that would let the caller confirm the address exists.
    expect(notifications.emit).not.toHaveBeenCalledWith(
      'auth.email_verification_requested',
      expect.anything(),
    );
  });

  it('hashes the password even when the address is taken, so both paths cost the same', async () => {
    const { service, prisma } = createService();
    findUniqueBy(prisma, (where) => (where.email ? userFixture() : null));
    const bcrypt = jest.requireMock('bcrypt');

    await service.register(REGISTER_DTO as never);

    // A short-circuit here answered in microseconds instead of ~100ms, which
    // is a timing oracle for the same fact the uniform response hides.
    expect(bcrypt.hash).toHaveBeenCalledWith('Password1', 10);
  });

  it('still refuses a phone that belongs to someone else', async () => {
    const { service, prisma } = createService();
    // The email is free, the phone is not.
    findUniqueBy(prisma, (where) => (where.phone ? userFixture() : null));

    await expect(service.register(REGISTER_DTO as never)).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does not probe the phone when none was supplied', async () => {
    const { service, prisma } = createService();

    await service.register({ ...REGISTER_DTO, phone: undefined } as never);

    const probed = (prisma.user.findUnique.mock.calls as unknown as [{ where: any }][]).map(([args]) => args.where);
    expect(probed).toContainEqual({ email: 'guest@chicago.ru' });
    expect(probed.some((where: any) => 'phone' in where)).toBe(false);
  });

  it('stores the email lowercased and the password hashed with the configured rounds', async () => {
    const { service, prisma } = createService();

    await service.register(REGISTER_DTO as never);

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'guest@chicago.ru', passwordHash: 'hashed:Password1:10' }),
    });
  });

  it('returns nothing about the account it may or may not have created', async () => {
    const { service } = createService();

    const result = await service.register(REGISTER_DTO as never);

    expect(result).toEqual({ status: 'verification_sent' });
  });

  it('generates an eight-character referral code', async () => {
    const { service, prisma } = createService();

    await service.register(REGISTER_DTO as never);

    const { referralCode } = prisma.user.create.mock.calls[0][0].data as { referralCode: string };
    expect(referralCode).toMatch(/^[0-9A-F]{8}$/);
  });

  it('retries when the generated referral code collides', async () => {
    const { service, prisma } = createService();
    let collisions = 2;
    // Keyed on the clause rather than call order: the email and phone probes
    // go through the same delegate.
    findUniqueBy(prisma, (where) => {
      if (!where.referralCode) return null;
      return collisions-- > 0 ? userFixture() : null;
    });

    await service.register({ ...REGISTER_DTO, referralCode: undefined } as never);

    const codeProbes = (prisma.user.findUnique.mock.calls as unknown as [{ where: any }][]).filter(
      ([args]) => 'referralCode' in args.where,
    );
    expect(codeProbes).toHaveLength(3);
    expect(prisma.user.create).toHaveBeenCalled();
  });

  it('gives up rather than looping forever on referral-code collisions', async () => {
    const { service, prisma } = createService();
    findUniqueBy(prisma, (where) => (where.referralCode ? userFixture() : null));

    await expect(service.register({ ...REGISTER_DTO, referralCode: undefined } as never)).rejects.toThrow(
      /уникальный реферальный код/,
    );
  });

  it('links the referrer and records the referral', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: { referralCode?: string } }) =>
      where.referralCode === 'FRIEND01' ? (userFixture({ id: 'referrer-1' }) as never) : null,
    );

    await service.register({ ...REGISTER_DTO, referralCode: 'friend01' } as never);

    // The code is stored uppercase, so the lookup must normalise it.
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { referralCode: 'FRIEND01' } });
    // Who invited whom lives in one place — the `Referral` row, not a second
    // denormalised column on the user.
    expect(prisma.user.create.mock.calls[0][0].data).not.toHaveProperty('referredById');
    expect(prisma.referral.create).toHaveBeenCalledWith({
      data: { referrerId: 'referrer-1', referredUserId: expect.any(String) },
    });
  });

  it('ignores a referral code nobody owns', async () => {
    const { service, prisma } = createService();

    await service.register({ ...REGISTER_DTO, referralCode: 'NOPE0000' } as never);

    expect(prisma.referral.create).not.toHaveBeenCalled();
  });

  it('emits the verification email and the registration event', async () => {
    const { service, notifications } = createService();

    await service.register(REGISTER_DTO as never);

    expect(notifications.emit).toHaveBeenCalledWith(
      'auth.email_verification_requested',
      expect.objectContaining({ email: 'guest@chicago.ru', code: expect.stringMatching(/^\d{6}$/) }),
    );
    expect(notifications.emit).toHaveBeenCalledWith('user.registered', expect.objectContaining({ email: 'guest@chicago.ru' }));
  });

  it('stores only the hash of the verification code', async () => {
    const { service, prisma, notifications } = createService();

    await service.register(REGISTER_DTO as never);

    const emitted = notifications.emit.mock.calls.find(([event]) => event === 'auth.email_verification_requested')![1] as {
      code: string;
    };
    const stored = prisma.emailVerificationCode.create.mock.calls[0][0].data as { codeHash: string; expiresAt: Date };

    expect(stored.codeHash).toBe(sha256(emitted.code));
    expect(stored.codeHash).not.toBe(emitted.code);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('AuthService — email verification', () => {
  it('rejects an unknown address', async () => {
    const { service } = createService();

    await expect(service.verifyEmail({ email: 'nobody@chicago.ru', code: '123456' } as never)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('is idempotent for an already verified account', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ isEmailVerified: true }) as never);

    await expect(service.verifyEmail({ email: 'guest@chicago.ru', code: '123456' } as never)).resolves.toEqual({
      verified: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('matches the code by hash, unconsumed and unexpired', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);
    prisma.emailVerificationCode.findFirst.mockResolvedValue({ id: 'code-1' } as never);

    await service.verifyEmail({ email: 'guest@chicago.ru', code: '424242' } as never);

    expect(prisma.emailVerificationCode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ codeHash: sha256('424242'), consumedAt: null }),
      }),
    );
  });

  it('rejects a wrong or expired code', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);

    await expect(service.verifyEmail({ email: 'guest@chicago.ru', code: '000000' } as never)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('consumes the code and flips the flag in one transaction', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);
    prisma.emailVerificationCode.findFirst.mockResolvedValue({ id: 'code-1' } as never);

    await expect(service.verifyEmail({ email: 'guest@chicago.ru', code: '424242' } as never)).resolves.toEqual({
      verified: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.emailVerificationCode.update).toHaveBeenCalledWith({
      where: { id: 'code-1' },
      data: { consumedAt: expect.any(Date) },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { isEmailVerified: true } });
  });

  /**
   * A six-digit code is a million possibilities, but the only thing slowing a
   * guesser down used to be the gateway's per-IP limit — which an attacker
   * with a pool of addresses does not feel. The budget belongs to the account.
   */
  it('burns the outstanding codes once the guess budget is spent', async () => {
    const { service, prisma, cache } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);
    cache.incrWithTtl.mockResolvedValue(6 as never);

    await expect(service.verifyEmail({ email: 'guest@chicago.ru', code: '000000' } as never)).rejects.toThrow(
      /Слишком много попыток/,
    );

    // Waiting out the counter must not hand the guesser the same target back.
    expect(prisma.emailVerificationCode.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    // And the code itself was never even looked up.
    expect(prisma.emailVerificationCode.findFirst).not.toHaveBeenCalled();
  });

  it('counts each attempt against the account, not the caller', async () => {
    const { service, prisma, cache } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);

    await expect(service.verifyEmail({ email: 'guest@chicago.ru', code: '000000' } as never)).rejects.toThrow();

    expect(cache.incrWithTtl).toHaveBeenCalledWith('auth:verify:attempts:user-1', 900);
  });

  it('gives the budget back when the right code arrives', async () => {
    const { service, prisma, cache } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);
    prisma.emailVerificationCode.findFirst.mockResolvedValue({ id: 'code-1' } as never);

    await service.verifyEmail({ email: 'guest@chicago.ru', code: '424242' } as never);

    expect(cache.del).toHaveBeenCalledWith('auth:verify:attempts:user-1');
  });
});

describe('AuthService — resending the verification code', () => {
  it('claims success for an unknown address without sending anything', async () => {
    const { service, notifications } = createService();

    await expect(service.resendVerification({ email: 'ghost@chicago.ru' } as never)).resolves.toEqual({ sent: true });
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('claims success for an already verified address', async () => {
    const { service, prisma, notifications } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ isEmailVerified: true }) as never);

    await expect(service.resendVerification({ email: 'guest@chicago.ru' } as never)).resolves.toEqual({ sent: true });
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('sends a fresh code within the allowance', async () => {
    const { service, prisma, cache, notifications } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);
    cache.incrWithTtl.mockResolvedValue(3 as never);

    await service.resendVerification({ email: 'guest@chicago.ru' } as never);

    expect(cache.incrWithTtl).toHaveBeenCalledWith('auth:verify:resend:user-1', 60);
    expect(notifications.emit).toHaveBeenCalledWith('auth.email_verification_requested', expect.anything());
  });

  it('throttles the fourth request in a minute', async () => {
    const { service, prisma, cache, notifications } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);
    cache.incrWithTtl.mockResolvedValue(4 as never);

    await expect(service.resendVerification({ email: 'guest@chicago.ru' } as never)).rejects.toThrow(
      BadRequestException,
    );
    expect(notifications.emit).not.toHaveBeenCalled();
  });
});

describe('AuthService — login', () => {
  const CREDENTIALS = { email: 'Guest@Chicago.RU', password: 'Password1' };

  it('issues a token pair for valid credentials', async () => {
    const { service, prisma, tokens } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);

    const result = await service.login(CREDENTIALS as never, { ip: '10.0.0.1' } as never);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'guest@chicago.ru' } });
    expect(tokens.issueTokenPair).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), { ip: '10.0.0.1' });
    expect(result.tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('clears both failure counters after a successful login', async () => {
    const { service, prisma, cache } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);

    await service.login(CREDENTIALS as never, { ip: '10.0.0.1' } as never);

    const [cleared] = cache.del.mock.calls;
    expect(cleared).toHaveLength(2);
    expect(cleared.every((key: string) => key.startsWith('auth:login:fail:'))).toBe(true);
  });

  it('rejects an unknown account and counts the attempt against both budgets', async () => {
    const { service, cache } = createService();

    await expect(service.login(CREDENTIALS as never, { ip: '10.0.0.1' } as never)).rejects.toThrow(
      new UnauthorizedException('Неверный email или пароль'),
    );

    const counted = (cache.incrWithTtl.mock.calls as unknown as [string, number][]).map(([key]) => key);
    expect(counted).toHaveLength(2);
    // One key for this (account, source) pair, one for the account overall.
    expect(counted.filter((key: string) => key.split(':').length === 5)).toHaveLength(1);
    expect(counted.filter((key: string) => key.split(':').length === 4)).toHaveLength(1);
    expect(cache.incrWithTtl).toHaveBeenCalledWith(expect.any(String), 900);
  });

  it('keeps the address itself out of the Redis key', async () => {
    const { service, cache } = createService();

    await expect(service.login(CREDENTIALS as never, { ip: '10.0.0.1' } as never)).rejects.toThrow();

    // Keys are readable by anyone with a shell on the box; an address is
    // personal data, so only its digest goes in.
    for (const [key] of cache.incrWithTtl.mock.calls as unknown as [string, number][]) {
      expect(key).not.toContain('guest@chicago.ru');
    }
  });

  /**
   * The old counter was keyed on the address alone, so five wrong passwords
   * from anywhere locked the rightful owner out — repeatable forever, against
   * anyone whose address you could guess.
   */
  it('does not let one source lock an account out for everyone else', async () => {
    const { service, prisma, cache } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);

    const attackerPair = sha256('guest@chicago.ru').slice(0, 32);
    cache.get.mockImplementation(async (key: string) =>
      key === `auth:login:fail:${attackerPair}:${sha256('66.66.66.66').slice(0, 16)}` ? 5 : 0,
    );

    // The attacker's own source is locked …
    await expect(service.login(CREDENTIALS as never, { ip: '66.66.66.66' } as never)).rejects.toThrow(
      /Слишком много неудачных попыток/,
    );
    // … while the owner signs in from their phone as usual.
    await expect(service.login(CREDENTIALS as never, { ip: '10.0.0.1' } as never)).resolves.toBeDefined();
  });

  it('still stops a distributed attack through the account-wide budget', async () => {
    const { service, prisma, cache } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);
    const account = `auth:login:fail:${sha256('guest@chicago.ru').slice(0, 32)}`;
    // Fifty failures spread across many sources is nobody's bad evening.
    cache.get.mockImplementation(async (key: string) => (key === account ? 50 : 0));

    await expect(service.login(CREDENTIALS as never, { ip: '10.0.0.1' } as never)).rejects.toThrow(
      /Слишком много неудачных попыток/,
    );
  });

  it('rejects a wrong password with the same message as an unknown account', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);

    // Identical wording keeps the endpoint from confirming which emails exist.
    await expect(service.login({ ...CREDENTIALS, password: 'Wrong1' } as never)).rejects.toThrow(
      new UnauthorizedException('Неверный email или пароль'),
    );
  });

  it('locks a source out once its attempt budget is spent', async () => {
    const { service, prisma, cache } = createService();
    cache.get.mockResolvedValue(5 as never);

    await expect(service.login(CREDENTIALS as never)).rejects.toThrow(/Слишком много неудачных попыток/);
    // The database is never touched once the budget is gone.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a blocked account even with the right password', async () => {
    const { service, prisma, tokens } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ isBlocked: true }) as never);

    await expect(service.login(CREDENTIALS as never)).rejects.toThrow(
      new UnauthorizedException('Аккаунт заблокирован'),
    );
    expect(tokens.issueTokenPair).not.toHaveBeenCalled();
  });
});

describe('AuthService — session lifecycle', () => {
  it('rotates the refresh token', async () => {
    const { service, tokens } = createService();

    await expect(service.refresh('old-token', { ip: '1.1.1.1' } as never)).resolves.toEqual({
      tokens: { accessToken: 'a2', refreshToken: 'r2' },
    });
    expect(tokens.rotate).toHaveBeenCalledWith('old-token', { ip: '1.1.1.1' });
  });

  it('rotates without a context when the gateway sends none', async () => {
    const { service, tokens } = createService();

    await service.refresh('old-token');

    expect(tokens.rotate).toHaveBeenCalledWith('old-token', {});
  });

  it('revokes the refresh token on logout', async () => {
    const { service, tokens } = createService();

    await expect(service.logout('token')).resolves.toEqual({ success: true });
    expect(tokens.revoke).toHaveBeenCalledWith('token');
  });
});

describe('AuthService — password reset', () => {
  it('stays silent about unknown addresses', async () => {
    const { service, prisma, notifications } = createService();

    await expect(service.requestPasswordReset({ email: 'ghost@chicago.ru' } as never)).resolves.toEqual({ sent: true });
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('stores only the hash and mails the raw token', async () => {
    const { service, prisma, notifications } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);

    await service.requestPasswordReset({ email: 'guest@chicago.ru' } as never);

    const stored = prisma.passwordResetToken.create.mock.calls[0][0].data as { tokenHash: string; expiresAt: Date };
    const emitted = notifications.emit.mock.calls[0][1] as { token: string };

    expect(stored.tokenHash).toBe(sha256(emitted.token));
    expect(emitted.token).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it.each([
    ['an unknown token', null],
    ['a consumed token', { id: 'r1', userId: 'user-1', consumedAt: new Date(), expiresAt: new Date(Date.now() + 1000) }],
    ['an expired token', { id: 'r1', userId: 'user-1', consumedAt: null, expiresAt: new Date(Date.now() - 1000) }],
  ])('refuses to reset with %s', async (_label, record) => {
    const { service, prisma } = createService();
    prisma.passwordResetToken.findUnique.mockResolvedValue(record as never);

    await expect(service.resetPassword({ token: 'tok', newPassword: 'NewPass1' } as never)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('sets the new hash, consumes the token and kills every session', async () => {
    const { service, prisma, tokens } = createService();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'user-1',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(service.resetPassword({ token: 'tok', newPassword: 'NewPass1' } as never)).resolves.toEqual({
      success: true,
    });

    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('tok') } });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'hashed:NewPass1:10' },
    });
    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { consumedAt: expect.any(Date) },
    });
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
  });

  it('voids the access tokens already in the wild', async () => {
    const { service, prisma, cache } = createService();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'user-1',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    await service.resetPassword({ token: 'tok', newPassword: 'NewPass1' } as never);

    expect(cache.set).toHaveBeenCalledWith('auth:revoked-before:user-1', expect.any(Number), 900);
  });
});

describe('AuthService — profile', () => {
  it('returns the public projection', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture() as never);

    await expect(service.getProfile('user-1')).resolves.toMatchObject({ id: 'user-1', loyaltyLevel: 'BRONZE' });
  });

  it('404s for a user that no longer exists', async () => {
    const { service } = createService();

    await expect(service.getProfile('ghost')).rejects.toThrow(NotFoundException);
  });

  it('writes the submitted fields', async () => {
    const { service, prisma } = createService();

    await service.updateProfile('user-1', { firstName: 'Патимат', locale: 'en' } as never);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { firstName: 'Патимат', locale: 'en' },
    });
  });
});

describe('AuthService — admin operations', () => {
  const ADMIN = 'admin-1';

  it('lists users newest first with pagination metadata', async () => {
    const { service, prisma } = createService();
    prisma.user.count.mockResolvedValue(45 as never);

    const page = await service.adminListUsers({ page: 3, limit: 20 });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {},
      skip: 40,
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    expect(page).toMatchObject({ total: 45, page: 3, limit: 20, totalPages: 3 });
    expect(page.items[0]).not.toHaveProperty('passwordHash');
  });

  it('searches email, name and phone case-insensitively', async () => {
    const { service, prisma } = createService();

    await service.adminListUsers({ page: 1, limit: 10, search: 'амина' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { email: { contains: 'амина', mode: 'insensitive' } },
            { firstName: { contains: 'амина', mode: 'insensitive' } },
            { phone: { contains: 'амина' } },
          ],
        },
      }),
    );
  });

  it('revokes sessions when a role changes so the old token cannot keep its rights', async () => {
    const { service, prisma, tokens } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ role: 'USER' }) as never);

    await service.adminSetRole('user-1', 'ADMIN' as never, ADMIN);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { role: 'ADMIN' } });
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
  });

  it('voids access tokens immediately, not only refresh tokens', async () => {
    const { service, prisma, cache } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ role: 'USER' }) as never);

    await service.adminSetRole('user-1', 'COURIER' as never, ADMIN);

    // Without this stamp a demoted admin kept their rights until the access
    // token expired — up to fifteen minutes.
    expect(cache.set).toHaveBeenCalledWith('auth:revoked-before:user-1', expect.any(Number), 900);
  });

  it('refuses to change your own role', async () => {
    const { service, prisma } = createService();

    await expect(service.adminSetRole(ADMIN, 'USER' as never, ADMIN)).rejects.toThrow(/собственную роль/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses to demote the last administrator', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ id: 'user-2', role: 'ADMIN' }) as never);
    prisma.user.count.mockResolvedValue(1 as never);

    await expect(service.adminSetRole('user-2', 'USER' as never, ADMIN)).rejects.toThrow(/последнего администратора/);
  });

  it('allows demoting an administrator while another one remains', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ id: 'user-2', role: 'ADMIN' }) as never);
    prisma.user.count.mockResolvedValue(2 as never);

    await expect(service.adminSetRole('user-2', 'USER' as never, ADMIN)).resolves.toBeDefined();
  });

  it('404s when the target user is gone', async () => {
    const { service } = createService();

    await expect(service.adminSetRole('ghost', 'USER' as never, ADMIN)).rejects.toThrow(NotFoundException);
  });

  it('revokes sessions when blocking a user', async () => {
    const { service, prisma, tokens, cache } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ role: 'USER' }) as never);

    await service.adminSetBlocked('user-1', true, ADMIN);

    expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(cache.set).toHaveBeenCalledWith('auth:revoked-before:user-1', expect.any(Number), 900);
  });

  it('refuses to block your own account', async () => {
    const { service, prisma } = createService();

    await expect(service.adminSetBlocked(ADMIN, true, ADMIN)).rejects.toThrow(/собственный аккаунт/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses to block the last administrator', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ id: 'user-2', role: 'ADMIN' }) as never);
    prisma.user.count.mockResolvedValue(1 as never);

    await expect(service.adminSetBlocked('user-2', true, ADMIN)).rejects.toThrow(/последнего администратора/);
  });

  it('leaves sessions alone when unblocking', async () => {
    const { service, prisma, tokens, cache } = createService();
    prisma.user.findUnique.mockResolvedValue(userFixture({ role: 'USER' }) as never);

    await service.adminSetBlocked('user-1', false, ADMIN);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { isBlocked: false } });
    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });
});
