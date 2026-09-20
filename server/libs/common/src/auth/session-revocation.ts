import { RedisCacheService } from '../redis/redis-cache.service';
import { JwtPayload } from '../types/jwt-payload.interface';

/**
 * Blocking a user or changing their role revokes their refresh tokens, but an
 * access token already in the wild stays valid until it expires — up to
 * `JWT_ACCESS_TTL`. A blocked customer could keep ordering for another quarter
 * of an hour, and a demoted admin kept their rights just as long.
 *
 * So the auth service stamps "everything issued before X is void" into Redis,
 * and the gateway checks that stamp on every request. The key expires by
 * itself once no token issued before X can still be valid, which keeps the
 * denylist tiny — one short-lived key per affected user, not per token.
 */
const KEY_PREFIX = 'auth:revoked-before:';

export const sessionRevocationKey = (userId: string) => `${KEY_PREFIX}${userId}`;

/**
 * Redis pub/sub channel carrying the id of a user whose sessions were just
 * revoked.
 *
 * The Redis *key* above is enough for REST, which re-reads it on every
 * request. A WebSocket is different: it authenticates once and then sits
 * there for hours, so a blocked customer kept receiving live order and chat
 * events on a connection opened before the block. The gateway listens on this
 * channel and drops that user's sockets the moment auth publishes here.
 */
export const SESSION_REVOKED_CHANNEL = 'auth:session-revoked';

/** Marks every token issued up to now as no longer acceptable. */
export async function revokeSessionsBefore(
  cache: RedisCacheService,
  userId: string,
  accessTokenTtlSeconds: number,
): Promise<void> {
  await cache.set(sessionRevocationKey(userId), Date.now(), accessTokenTtlSeconds);
  // Fan-out to the gateways so open sockets go down now rather than whenever
  // the customer happens to reconnect.
  await cache.client.publish(SESSION_REVOKED_CHANNEL, userId);
}

/** True when this token was issued before the user's sessions were revoked. */
export async function isSessionRevoked(cache: RedisCacheService, payload: JwtPayload): Promise<boolean> {
  const revokedBefore = await cache.get<number>(sessionRevocationKey(payload.sub));
  if (!revokedBefore) return false;

  // `iat` is in seconds. A token without one cannot be placed in time, so it
  // is treated as older than the revocation.
  const issuedAtMs = (payload.iat ?? 0) * 1000;
  return issuedAtMs < revokedBefore;
}

/**
 * Converts the `JWT_ACCESS_TTL` string ("15m", "1h", "900") into seconds.
 * Falls back to 15 minutes for anything unparseable, which is the default TTL.
 */
export function parseTtlSeconds(ttl: string | undefined, fallbackSeconds = 15 * 60): number {
  if (!ttl) return fallbackSeconds;

  const match = /^(\d+)\s*([smhd])?$/i.exec(ttl.trim());
  if (!match) return fallbackSeconds;

  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multiplier = { s: 1, m: 60, h: 3600, d: 86_400 }[unit] ?? 1;

  return value * multiplier;
}
