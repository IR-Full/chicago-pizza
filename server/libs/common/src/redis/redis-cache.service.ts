import { Inject, Injectable, Logger, Optional, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
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
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);

  private readonly disposable: Redis;
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() config?: ConfigService,
  ) {
    const url = config?.get<string>('CACHE_REDIS_URL');
    this.disposable = url ? new Redis(url) : redis;
  }
  async onModuleDestroy() {
    if (this.disposable !== this.redis) await this.disposable.quit();
  }

  private forKey(key: string): Redis {
    return /^(catalog|branches|zones|analytics):/.test(key) ? this.disposable : this.redis;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.forKey(key).get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.forKey(key).set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  /**
   * Writes a key only if nobody holds it yet, and reports whether the write
   * won. This is the primitive behind an idempotent operation: the request
   * that claims the key does the work, and every retry of it recognises that
   * it lost and reuses the first one's answer instead of repeating it.
   */
  async setIfAbsent(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    const result = await this.forKey(key).set(key, JSON.stringify(value), 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async setWhileOwned(
    lockKey: string,
    owner: string,
    key: string,
    value: unknown,
    ttl: number,
  ): Promise<boolean> {
    const result = await this.redis.eval(
      "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3]); return 1",
      2,
      lockKey,
      key,
      JSON.stringify(owner),
      JSON.stringify(value),
      String(ttl),
    );
    return Number(result) === 1;
  }

  async releaseLock(key: string, owner: string): Promise<void> {
    await this.forKey(key).eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1,
      key,
      JSON.stringify(owner),
    );
  }

  async del(...keys: string[]): Promise<void> {
    const groups = new Map<Redis, string[]>();
    for (const key of keys) {
      const client = this.forKey(key);
      const batch = groups.get(client) ?? [];
      batch.push(key);
      groups.set(client, batch);
    }
    await Promise.all([...groups].map(([client, batch]) => client.del(...batch)));
  }

  /** Deletes every key matching a glob pattern using SCAN (never KEYS, which blocks Redis). */
  async delByPattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.forKey(pattern).scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length) await this.del(...keys);
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
    const raw = await this.forKey(key).get(key);
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
   * Fixed-window counter used for login throttling and rate limiting.
   * Returns the current count after incrementing.
   *
   * One script, not `INCR` then `EXPIRE`, because the two-command version had a
   * failure mode that pointed the wrong way. If the process died — or the
   * connection dropped — between them, the key was left with no expiry at all,
   * and these keys are what decide whether an account is locked out. A counter
   * that never resets is a permanent lockout of a real customer, created by a
   * crash, with nothing to show why; the only cure was deleting the key by hand
   * in Redis, which assumes somebody knew to look.
   *
   * `EXPIRE` is re-applied only on the first increment, so the window still
   * starts at the first failure rather than sliding forward with every attempt
   * — otherwise an attacker hammering an account would keep the lockout alive
   * indefinitely, which is the other way to turn a defence into the attack.
   */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = (await this.redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return n`,
      1,
      key,
      String(ttlSeconds),
    )) as number;

    return count;
  }

  get client(): Redis {
    return this.redis;
  }
}
