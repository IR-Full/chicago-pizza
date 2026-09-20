import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TokenService } from './token.service';

/**
 * Refresh-token rotation is the highest-risk auth logic here: a mistake
 * either locks everyone out or lets a stolen token be replayed forever.
 */

const CONFIG: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 'test-access-secret-value',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL_DAYS: 30,
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function createHarness(storedToken: Record<string, unknown> | null, revokeWins = true) {
  const created: Record<string, unknown>[] = [];

  const prisma = {
    refreshToken: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      }),
      findUnique: jest.fn(() => storedToken),
      update: jest.fn(),
      // Rotation revokes conditionally: `count: 0` means somebody else got
      // there first, which is how a replay is detected.
      updateMany: jest.fn(({ where }: { where: Record<string, unknown> }) => ({
        count: 'revokedAt' in where && 'id' in where && !revokeWins ? 0 : 1,
      })),
    },
  };

  const jwt = { signAsync: jest.fn(async () => 'signed.access.token') };
  const config = { get: jest.fn((key: string) => CONFIG[key]) };

  const service = new TokenService(jwt as never, config as never, prisma as never);
  return { service, prisma, jwt, created };
}

const USER = { id: 'user-1', email: 'a@b.ru', role: 'USER' as const };

describe('TokenService', () => {
  describe('issueTokenPair', () => {
    it('stores only a hash of the refresh token, never the token itself', async () => {
      const { service, created } = createHarness(null);

      const pair = await service.issueTokenPair(USER);

      expect(created).toHaveLength(1);
      expect(created[0].tokenHash).toBe(sha256(pair.refreshToken));
      // The raw token must not be anywhere in the persisted row.
      expect(JSON.stringify(created[0])).not.toContain(pair.refreshToken);
    });

    it('issues a distinct refresh token every time', async () => {
      const { service } = createHarness(null);

      const first = await service.issueTokenPair(USER);
      const second = await service.issueTokenPair(USER);

      expect(first.refreshToken).not.toBe(second.refreshToken);
    });

    it('records the requesting ip and user agent for auditability', async () => {
      const { service, created } = createHarness(null);

      await service.issueTokenPair(USER, { ip: '10.0.0.1', userAgent: 'Firefox' });

      expect(created[0]).toMatchObject({ ip: '10.0.0.1', userAgent: 'Firefox' });
    });
  });

  describe('rotate', () => {
    const validStored = {
      id: 'rt-1',
      userId: USER.id,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { ...USER, isBlocked: false },
    };

    it('revokes the presented token and issues a new pair', async () => {
      const { service, prisma } = createHarness(validStored);

      const pair = await service.rotate('some-refresh-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(pair.refreshToken).toBeDefined();
    });

    it('revokes the whole token family when an already-revoked token is replayed', async () => {
      // Nothing left to revoke — the row was revoked before this call.
      const { service, prisma } = createHarness({ ...validStored, revokedAt: new Date() }, false);

      await expect(service.rotate('stolen-token')).rejects.toBeInstanceOf(UnauthorizedException);

      // Reuse means the token leaked — every session for that user must die.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: USER.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('lets only one of two simultaneous rotations through', async () => {
      // Both callers read the same un-revoked row; the conditional update is
      // what decides the winner. Before it existed, both got a fresh pair and
      // reuse detection never fired.
      const { service } = createHarness(validStored, false);

      await expect(service.rotate('same-token')).rejects.toThrow(/повторное использование/i);
    });

    it('rejects an unknown token', async () => {
      const { service } = createHarness(null);

      await expect(service.rotate('nonexistent')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      const { service } = createHarness({ ...validStored, expiresAt: new Date(Date.now() - 1000) });

      await expect(service.rotate('old-token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a token belonging to a blocked account', async () => {
      const { service } = createHarness({ ...validStored, user: { ...USER, isBlocked: true } });

      await expect(service.rotate('token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('looks the token up by hash, not by raw value', async () => {
      const { service, prisma } = createHarness(validStored);

      await service.rotate('my-token');

      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256('my-token') },
        include: { user: true },
      });
    });
  });

  describe('revocation', () => {
    it('revokes a single token by hash', async () => {
      const { service, prisma } = createHarness(null);

      await service.revoke('logout-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: sha256('logout-token'), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('revokes every active session for a user', async () => {
      const { service, prisma } = createHarness(null);

      await service.revokeAllForUser('user-1');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
