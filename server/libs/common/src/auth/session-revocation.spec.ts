import { isSessionRevoked, parseTtlSeconds, revokeSessionsBefore, sessionRevocationKey } from './session-revocation';
import type { RedisCacheService } from '../redis/redis-cache.service';

const cacheWith = (stored: number | null) =>
  ({
    get: jest.fn(async () => stored),
    set: jest.fn(async () => undefined),
    // Revocation also fans out over Redis pub/sub so live sockets drop.
    client: { publish: jest.fn(async () => 1) },
  }) as unknown as RedisCacheService;

const payload = (iat?: number) => ({ sub: 'user-1', email: 'a@b.ru', role: 'USER' as never, iat });

/**
 * Revoking refresh tokens alone left a blocked customer ordering — and a
 * demoted admin administering — for as long as their access token lived.
 */
describe('session revocation', () => {
  it('namespaces the key per user', () => {
    expect(sessionRevocationKey('user-1')).toBe('auth:revoked-before:user-1');
  });

  it('stamps "now" with the access-token lifetime as its TTL', async () => {
    const cache = cacheWith(null);

    await revokeSessionsBefore(cache, 'user-1', 900);

    expect(cache.set).toHaveBeenCalledWith('auth:revoked-before:user-1', expect.any(Number), 900);
    // The key expires by itself once no token issued before it can be valid.
    const [, stamped] = (cache.set as jest.Mock).mock.calls[0];
    expect(stamped).toBeCloseTo(Date.now(), -3);
  });

  it('announces the revocation so open WebSockets are dropped, not just REST', async () => {
    const cache = cacheWith(null);

    await revokeSessionsBefore(cache, 'user-1', 900);

    expect(cache.client.publish).toHaveBeenCalledWith('auth:session-revoked', 'user-1');
  });

  it('lets a token through when nothing was revoked', async () => {
    await expect(isSessionRevoked(cacheWith(null), payload(Math.floor(Date.now() / 1000)))).resolves.toBe(false);
  });

  it('rejects a token issued before the revocation', async () => {
    const revokedAt = Date.now();
    const issuedEarlier = Math.floor((revokedAt - 60_000) / 1000);

    await expect(isSessionRevoked(cacheWith(revokedAt), payload(issuedEarlier))).resolves.toBe(true);
  });

  it('accepts a token issued after the revocation — that is the fresh login', async () => {
    const revokedAt = Date.now() - 60_000;
    const issuedLater = Math.floor(Date.now() / 1000);

    await expect(isSessionRevoked(cacheWith(revokedAt), payload(issuedLater))).resolves.toBe(false);
  });

  it('treats a token without an issued-at as too old to trust', async () => {
    await expect(isSessionRevoked(cacheWith(Date.now()), payload(undefined))).resolves.toBe(true);
  });
});

describe('parseTtlSeconds', () => {
  it.each([
    ['15m', 900],
    ['1h', 3600],
    ['7d', 604_800],
    ['30s', 30],
    ['900', 900],
  ])('reads %p as %i seconds', (ttl, expected) => {
    expect(parseTtlSeconds(ttl)).toBe(expected);
  });

  it.each([[undefined], [''], ['soon'], ['15 minutes']])('falls back to 15 minutes for %p', (ttl) => {
    expect(parseTtlSeconds(ttl as string | undefined)).toBe(900);
  });

  it('honours an explicit fallback', () => {
    expect(parseTtlSeconds(undefined, 60)).toBe(60);
  });
});
