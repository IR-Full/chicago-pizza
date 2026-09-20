import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { JwtStrategy } from './jwt.strategy';
import type { RedisCacheService } from '../redis/redis-cache.service';

function buildStrategy(secret = 'access-secret', revokedBefore: number | null = null) {
  const config = { get: jest.fn(() => secret) } as unknown as ConfigService;
  const cache = { get: jest.fn(async () => revokedBefore) } as unknown as RedisCacheService;
  return { strategy: new JwtStrategy(config, cache), config, cache };
}

/** passport-jwt keeps the configured extractor here. */
const extractorOf = (strategy: JwtStrategy) =>
  (strategy as unknown as { _jwtFromRequest: (req: Request) => string | null })._jwtFromRequest;

describe('JwtStrategy', () => {
  it('is configured with the access-token secret', () => {
    const { config } = buildStrategy();

    expect(config.get).toHaveBeenCalledWith('JWT_ACCESS_SECRET');
  });

  it('returns the payload as the request user', async () => {
    const { strategy } = buildStrategy();
    const payload = { sub: 'user-1', email: 'a@b.ru', role: 'USER' as const, iat: Math.floor(Date.now() / 1000) };

    await expect(strategy.validate(payload)).resolves.toBe(payload);
  });

  it('refuses a token issued before the account was blocked or demoted', async () => {
    // A valid signature is not enough — the gateway checks the revocation
    // stamp so a block takes effect now, not in fifteen minutes.
    const { strategy } = buildStrategy('access-secret', Date.now());
    const payload = { sub: 'user-1', email: 'a@b.ru', role: 'USER' as const, iat: Math.floor((Date.now() - 60_000) / 1000) };

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it('accepts the token issued by the login that followed a revocation', async () => {
    const { strategy } = buildStrategy('access-secret', Date.now() - 60_000);
    const payload = { sub: 'user-1', email: 'a@b.ru', role: 'USER' as const, iat: Math.floor(Date.now() / 1000) };

    await expect(strategy.validate(payload)).resolves.toBe(payload);
  });

  describe('token extraction', () => {
    it('reads the httpOnly access_token cookie first', () => {
      const { strategy } = buildStrategy();
      const request = { cookies: { access_token: 'from-cookie' }, headers: {} } as unknown as Request;

      expect(extractorOf(strategy)(request)).toBe('from-cookie');
    });

    it('falls back to the Authorization header for non-browser clients', () => {
      const { strategy } = buildStrategy();
      const request = { cookies: {}, headers: { authorization: 'Bearer from-header' } } as unknown as Request;

      expect(extractorOf(strategy)(request)).toBe('from-header');
    });

    it('prefers the cookie when both are present', () => {
      const { strategy } = buildStrategy();
      const request = {
        cookies: { access_token: 'from-cookie' },
        headers: { authorization: 'Bearer from-header' },
      } as unknown as Request;

      expect(extractorOf(strategy)(request)).toBe('from-cookie');
    });

    it('returns null when the request carries no token at all', () => {
      const { strategy } = buildStrategy();

      expect(extractorOf(strategy)({ cookies: {}, headers: {} } as unknown as Request)).toBeNull();
    });

    it('survives a request without a cookie parser', () => {
      const { strategy } = buildStrategy();

      expect(extractorOf(strategy)({ headers: {} } as unknown as Request)).toBeNull();
    });
  });
});
