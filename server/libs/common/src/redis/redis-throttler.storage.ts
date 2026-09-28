import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

/** The record type is not re-exported from the package root; derive it. */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Rate-limit counters in Redis instead of process memory.
 *
 * The default `ThrottlerModule` storage is a `Map` inside one Node process.
 * That makes the advertised "100 requests per minute" mean something else in
 * practice: every gateway replica keeps its own counter, so N replicas allow
 * N × 100, and a restart (deploy, crash, health-check kill) hands an attacker
 * a fresh budget. Redis is already in the stack for the cart and the session
 * denylist, so the counters live where every replica can see them.
 *
 * Counting is done in Lua so that "increment, set the expiry, decide whether
 * this hit crosses the limit" cannot interleave with another request — the
 * read-modify-write that a client-side implementation would need is exactly
 * how a burst slips past a limiter.
 */
const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttlMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockMs = tonumber(ARGV[3])

-- Already serving a block: report it without extending the window, so a
-- client hammering the endpoint cannot keep pushing its own release further
-- away (and cannot learn anything new by trying).
local blockPttl = redis.call('PTTL', blockKey)
if blockPttl > 0 then
  local current = tonumber(redis.call('GET', hitsKey) or '0')
  local hitsPttl = redis.call('PTTL', hitsKey)
  if hitsPttl < 0 then hitsPttl = 0 end
  return { current, hitsPttl, 1, blockPttl }
end

local hits = redis.call('INCR', hitsKey)
-- The key is created by INCR without a TTL; the first hit of a window sets it.
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttlMs) end

local pttl = redis.call('PTTL', hitsKey)
if pttl < 0 then
  redis.call('PEXPIRE', hitsKey, ttlMs)
  pttl = ttlMs
end

local blocked = 0
local blockTtl = 0
if hits > limit and blockMs > 0 then
  redis.call('SET', blockKey, '1', 'PX', blockMs)
  blocked = 1
  blockTtl = blockMs
end

return { hits, pttl, blocked, blockTtl }
`;

/** Nest hands durations in milliseconds and expects the answer in seconds. */
const toSeconds = (ms: number): number => Math.ceil(ms / 1000);

/** The script, reachable as `redis.throttlerIncrement(...)` once defined. */
const COMMAND_NAME = 'throttlerIncrement';

type RedisWithScript = Redis & {
  [COMMAND_NAME]: (...args: string[]) => Promise<[number, number, number, number]>;
};

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly redis: RedisWithScript;

  constructor(redis: Redis) {
    /**
     * Registered as a command rather than called through `eval`.
     *
     * `eval` ships the whole script body on every single call, and this one runs
     * on *every HTTP request* the gateway serves — roughly a kilobyte of Lua
     * across the wire per request, to execute something Redis already has. With
     * `defineCommand` ioredis sends `EVALSHA <hash>` instead and falls back to a
     * one-time `EVAL` if Redis answers NOSCRIPT (a restart, a `SCRIPT FLUSH`),
     * so the fast path costs a 40-byte digest and the slow path happens once.
     */
    if (!(COMMAND_NAME in redis)) {
      redis.defineCommand(COMMAND_NAME, { numberOfKeys: 2, lua: INCREMENT_SCRIPT });
    }
    this.redis = redis as RedisWithScript;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:blocked`;

    const [totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs] = await this.redis[COMMAND_NAME](
      hitsKey,
      blockKey,
      String(ttl),
      String(limit),
      String(blockDuration),
    );

    return {
      totalHits,
      timeToExpire: toSeconds(timeToExpireMs),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: toSeconds(timeToBlockExpireMs),
    };
  }
}
