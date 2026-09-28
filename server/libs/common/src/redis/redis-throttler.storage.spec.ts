import type Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * The storage behind every rate-limit decision the gateway makes.
 *
 * The counting itself happens in Lua inside Redis, so what is pinned here is the
 * contract around it: that the script is registered once and invoked by name,
 * that keys are namespaced per throttler, and that the millisecond answers Redis
 * returns are handed back to Nest in the seconds it expects.
 */
function buildStorage(reply: [number, number, number, number] = [1, 60_000, 0, 0]) {
  const throttlerIncrement = jest.fn(async (...__args: string[]) => reply);

  // ioredis installs the command as a method on the client, and the storage
  // skips defining one that is already there. A stub that simply records the
  // call — while carrying the method anyway — would let the skip look like a
  // definition.
  const client: Record<string, unknown> = {};
  const defineCommand = jest.fn((name: string) => {
    client[name] = throttlerIncrement;
  });
  client.defineCommand = defineCommand;

  const redis = client as unknown as Redis;

  return { storage: new RedisThrottlerStorage(redis), redis, defineCommand, throttlerIncrement };
}

describe('RedisThrottlerStorage', () => {
  describe('script registration', () => {
    it('registers the counter as a named command instead of eval-ing it per request', () => {
      // `eval` ships the whole script body every time, and this runs on every
      // single HTTP request. `defineCommand` makes ioredis send EVALSHA with a
      // one-time EVAL fallback on NOSCRIPT.
      const { defineCommand } = buildStorage();

      expect(defineCommand).toHaveBeenCalledWith(
        'throttlerIncrement',
        expect.objectContaining({ numberOfKeys: 2, lua: expect.stringContaining('redis.call') }),
      );
    });

    it('defines the command once when several instances share one client', () => {
      // Two throttlers on the same Redis connection is the normal arrangement;
      // redefining the script per instance would be pointless work at boot.
      const { redis, defineCommand } = buildStorage();

      new RedisThrottlerStorage(redis);
      new RedisThrottlerStorage(redis);

      expect(defineCommand).toHaveBeenCalledTimes(1);
    });

    it('never falls back to eval', async () => {
      const { storage, redis } = buildStorage();

      await storage.increment('1.2.3.4', 60_000, 100, 0, 'default');

      expect((redis as unknown as { eval?: unknown }).eval).toBeUndefined();
    });
  });

  describe('increment', () => {
    it('namespaces the hit and block keys by throttler and caller', async () => {
      const { storage, throttlerIncrement } = buildStorage();

      await storage.increment('1.2.3.4', 60_000, 100, 30_000, 'default');

      expect(throttlerIncrement).toHaveBeenCalledWith(
        'throttle:default:1.2.3.4',
        'throttle:default:1.2.3.4:blocked',
        '60000',
        '100',
        '30000',
      );
    });

    it('keeps two throttlers from sharing a counter', async () => {
      const { storage, throttlerIncrement } = buildStorage();

      await storage.increment('1.2.3.4', 60_000, 100, 0, 'default');
      await storage.increment('1.2.3.4', 60_000, 5, 0, 'login');

      const [firstKey] = throttlerIncrement.mock.calls[0];
      const [secondKey] = throttlerIncrement.mock.calls[1];
      expect(firstKey).not.toBe(secondKey);
    });

    it('reports the hit count and converts the window to seconds', async () => {
      // Nest hands durations in milliseconds and expects the answer in seconds.
      const { storage } = buildStorage([7, 42_000, 0, 0]);

      await expect(storage.increment('1.2.3.4', 60_000, 100, 0, 'default')).resolves.toEqual({
        totalHits: 7,
        timeToExpire: 42,
        isBlocked: false,
        timeToBlockExpire: 0,
      });
    });

    it('rounds a part-second remainder up, so a window never reads as already over', async () => {
      const { storage } = buildStorage([3, 1, 0, 0]);

      await expect(storage.increment('1.2.3.4', 60_000, 100, 0, 'default')).resolves.toMatchObject({
        timeToExpire: 1,
      });
    });

    it('surfaces a block with the time left on it', async () => {
      const { storage } = buildStorage([101, 30_000, 1, 15_500]);

      await expect(storage.increment('1.2.3.4', 60_000, 100, 30_000, 'default')).resolves.toMatchObject({
        isBlocked: true,
        timeToBlockExpire: 16,
      });
    });
  });
});
