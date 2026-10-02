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

function createHarness(
  storedToken: Record<string, unknown> | null,
  revokeWins = true,
  /**
   * What the winner of a rotation race has already published, if anything.
   * `null` is the replay case: nobody is mid-rotation, so the token presented
   * is simply being reused.
   */
  graceEntry: Record<string, unknown> | null = null,
) {
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
      // there first — either a parallel tab or a replay.
      updateMany: jest.fn(({ where }: { where: Record<string, unknown> }) => ({
        count: 'revokedAt' in where && 'id' in where && !revokeWins ? 0 : 1,
      })),
    },
  };

  const jwt = { signAsync: jest.fn(async () => 'signed.access.token') };
  const config = { get: jest.fn((key: string) => CONFIG[key]) };
  const cache = {
    get: jest.fn(async () => graceEntry),
    set: jest.fn(async () => undefined),
  };

  const service = new TokenService(jwt as never, config as never, prisma as never, cache as never);
  return { service, prisma, jwt, cache, created };
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

    it('publishes the pair it issued, so a parallel caller can share it', async () => {
      const { service, cache } = createHarness(validStored);

      const pair = await service.rotate('some-refresh-token');

      // Keyed by the digest of the token that was spent: finding the entry
      // requires already holding that token.
      expect(cache.set).toHaveBeenCalledWith(
        `auth:rotated:${sha256('some-refresh-token')}`,
        pair,
        expect.any(Number),
      );
    });

    it('revokes the whole token family when an already-revoked token is replayed', async () => {
      // Nothing left to revoke and nothing published: the row was revoked long
      // before this call, which is what a leaked token looks like.
      const { service, prisma } = createHarness({ ...validStored, revokedAt: new Date() }, false);

      await expect(service.rotate('stolen-token')).rejects.toBeInstanceOf(UnauthorizedException);

      // Reuse means the token leaked — every session for that user must die.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: USER.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    /**
     * The case that used to log real customers out of everything: the access
     * cookie expires on a timer, so two tabs — or a navigation and the fetch
     * it triggered — notice at the same instant and send the same refresh
     * cookie. Exactly one wins the conditional update; the other must get the
     * winner's pair, not a revoked family.
     */
    it('hands the loser of a race the winner’s pair instead of calling it a replay', async () => {
      const published = {
        accessToken: 'winners.access.token',
        refreshToken: 'winners-refresh-token',
        accessTokenTtl: '15m',
        refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      };
      const { service, prisma } = createHarness(validStored, false, published);

      const pair = await service.rotate('same-token');

      expect(pair.refreshToken).toBe('winners-refresh-token');
      expect(pair.accessToken).toBe('winners.access.token');
      // Crucially: the family survives.
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalledWith({
        where: { userId: USER.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('revives the expiry as a Date, which is what the cookie layer needs', async () => {
      const expiresAt = new Date(Date.now() + 86_400_000);
      const { service } = createHarness(validStored, false, {
        accessToken: 'a',
        refreshToken: 'b',
        accessTokenTtl: '15m',
        // JSON has no Date; this is how it comes back out of Redis.
        refreshTokenExpiresAt: expiresAt.toISOString(),
      });

      const pair = await service.rotate('same-token');

      expect(pair.refreshTokenExpiresAt).toBeInstanceOf(Date);
      expect(pair.refreshTokenExpiresAt.getTime()).toBe(expiresAt.getTime());
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
