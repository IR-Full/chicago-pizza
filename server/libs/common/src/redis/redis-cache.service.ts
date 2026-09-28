import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * How long one caller may hold the right to recompute a cold key. Short: it is
 * a courtesy to the database, not a correctness guarantee, and a crashed holder
 * must not lock the key out for long.
 */
const STAMPEDE_LOCK_TTL_SECONDS = 10;

/** How long a loser of the race waits for the winner's write before doing the
 *  work itself: 10 × 50ms. */
const STAMPEDE_WAIT_ATTEMPTS = 10;
const STAMPEDE_WAIT_MS = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /**
   * Writes a key only if nobody holds it yet, and reports whether the write
   * won. This is the primitive behind an idempotent operation: the request
   * that claims the key does the work, and every retry of it recognises that
   * it lost and reuses the first one's answer instead of repeating it.
   */
  async setIfAbsent(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys);
  }

  /** Deletes every key matching a glob pattern using SCAN (never KEYS, which blocks Redis). */
  async delByPattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length) await this.redis.del(...keys);
    } while (cursor !== '0');
  }

  /**
   * Read-through cache.
   *
   * Two things here are not the obvious implementation, and both are about what
   * happens on a *miss*.
   *
   * The value is stored wrapped in an envelope rather than bare. Testing the
   * raw read for `null` cannot tell "nothing is cached" from "the answer is
   * null", so a factory that legitimately returns null (or an empty list, once
   * `JSON.parse` is involved) was re-run on every single call — the one case
   * where caching matters most, because a miss is usually the expensive path.
   *
   * And concurrent misses are collapsed. Without that, the first request for a
   * cold key does not shield the others: all of them find nothing, all of them
   * run the factory, and the database takes N identical queries at the moment
   * it is least able to. The loser of the race waits briefly and reads what the
   * winner wrote; if it is still not there it runs the factory itself rather
   * than waiting indefinitely, because a stampede is a performance problem and
   * a deadlock is an outage.
   */
  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.readEnvelope<T>(key);
    if (cached) return cached.v;

    const lockKey = `${key}:lock`;
    const won = await this.setIfAbsent(lockKey, 1, STAMPEDE_LOCK_TTL_SECONDS);

    if (!won) {
      const shared = await this.awaitOtherFill<T>(key);
      if (shared) return shared.v;
      // The holder died, or is slower than we are willing to wait. Fall through
      // and do the work.
    }

    try {
      const fresh = await factory();
      await this.set(key, { v: fresh }, ttlSeconds);
      return fresh;
    } finally {
      // Released on failure too: a factory that threw must not lock the key out
      // for the whole lock TTL.
      if (won) await this.del(lockKey);
    }
  }

  private async readEnvelope<T>(key: string): Promise<{ v: T } | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as unknown;
    // Entries written before the envelope existed are still in Redis with their
    // original TTL. Reading one as a plain value keeps a deploy from serving a
    // wave of misses.
    if (parsed && typeof parsed === 'object' && 'v' in parsed) return parsed as { v: T };
    return { v: parsed as T };
  }

  /** Polls briefly for the lock holder's write. */
  private async awaitOtherFill<T>(key: string): Promise<{ v: T } | null> {
    for (let attempt = 0; attempt < STAMPEDE_WAIT_ATTEMPTS; attempt += 1) {
      await sleep(STAMPEDE_WAIT_MS);
      const filled = await this.readEnvelope<T>(key);
      if (filled) return filled;
    }
    return null;
  }

  /**
   * Sliding-window counter used for login throttling and rate limiting.
   * Returns the current count after incrementing.
   */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, ttlSeconds);
    return count;
  }

  get client(): Redis {
    return this.redis;
  }
}
