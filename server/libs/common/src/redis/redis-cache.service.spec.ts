import type Redis from 'ioredis';
import { RedisCacheService } from './redis-cache.service';

function buildService(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const redis = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    scan: jest.fn(async () => ['0', []]),
    incr: jest.fn(async () => 1),
    expire: jest.fn(async () => 1),
    // Varargs so the assertions below can read the script and its arguments.
    eval: jest.fn(async (..._args: unknown[]) => 1),
    ...overrides,
  };

  return { service: new RedisCacheService(redis as unknown as Redis), redis };
}

/** `wrap` also writes a lock key, so assertions about the *value* filter by key. */
function setCalls(redis: { set: jest.Mock }, key: string) {
  return redis.set.mock.calls.filter((call) => call[0] === key);
}

describe('RedisCacheService', () => {
  describe('get', () => {
    it('parses the stored JSON', async () => {
      const { service } = buildService({ get: jest.fn(async () => '{"id":"p1"}') });

      await expect(service.get('products:p1')).resolves.toEqual({ id: 'p1' });
    });

    it('returns null on a miss', async () => {
      const { service } = buildService();

      await expect(service.get('missing')).resolves.toBeNull();
    });
  });

  describe('set', () => {
    it('serialises the value with an expiry', async () => {
      const { service, redis } = buildService();

      await service.set('products:p1', { id: 'p1' }, 60);

      expect(redis.set).toHaveBeenCalledWith('products:p1', '{"id":"p1"}', 'EX', 60);
    });
  });

  describe('del', () => {
    it('forwards every key in one call', async () => {
      const { service, redis } = buildService();

      await service.del('a', 'b');

      expect(redis.del).toHaveBeenCalledWith('a', 'b');
    });

    it('skips the round trip when there is nothing to delete', async () => {
      const { service, redis } = buildService();

      await service.del();

      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('delByPattern', () => {
    it('walks the keyspace with SCAN and deletes each batch', async () => {
      const scan = jest
        .fn()
        .mockResolvedValueOnce(['17', ['products:a', 'products:b']])
        .mockResolvedValueOnce(['0', ['products:c']]);
      const { service, redis } = buildService({ scan });

      await service.delByPattern('products:*');

      expect(scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'products:*', 'COUNT', 200);
      expect(scan).toHaveBeenNthCalledWith(2, '17', 'MATCH', 'products:*', 'COUNT', 200);
      expect(redis.del).toHaveBeenNthCalledWith(1, 'products:a', 'products:b');
      expect(redis.del).toHaveBeenNthCalledWith(2, 'products:c');
    });

    it('never falls back to the blocking KEYS command', async () => {
      const { service, redis } = buildService();

      await service.delByPattern('products:*');

      expect(redis).not.toHaveProperty('keys');
      expect(redis.scan).toHaveBeenCalled();
    });

    it('does not call DEL for an empty batch', async () => {
      const { service, redis } = buildService();

      await service.delByPattern('nothing:*');

      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('wrap', () => {
    it('returns the cached value without invoking the factory', async () => {
      const { service } = buildService({ get: jest.fn(async () => '{"v":["cached"]}') });
      const factory = jest.fn();

      await expect(service.wrap('key', 30, factory)).resolves.toEqual(['cached']);
      expect(factory).not.toHaveBeenCalled();
    });

    it('computes, stores and returns a miss', async () => {
      const { service, redis } = buildService();
      const factory = jest.fn(async () => ({ fresh: true }));

      await expect(service.wrap('key', 30, factory)).resolves.toEqual({ fresh: true });
      expect(redis.set).toHaveBeenCalledWith('key', '{"v":{"fresh":true}}', 'EX', 30);
    });

    it('does not swallow a factory failure', async () => {
      const { service, redis } = buildService();

      await expect(service.wrap('key', 30, async () => Promise.reject(new Error('db down')))).rejects.toThrow(
        'db down',
      );
      expect(setCalls(redis, 'key')).toHaveLength(0);
    });

    it('releases the recompute lock when the factory throws', async () => {
      // Otherwise one failed query locks the key out for the lock's whole TTL,
      // and every caller behind it waits for a value nobody is producing.
      const { service, redis } = buildService();

      await expect(
        service.wrap('key', 30, async () => Promise.reject(new Error('db down'))),
      ).rejects.toThrow();
      expect(redis.del).toHaveBeenCalledWith('key:lock');
    });

    it('caches a null answer instead of recomputing it every time', async () => {
      // `null` is a perfectly good answer — "this customer has no open orders".
      // Testing the raw read for null could not tell it from a miss, so the
      // expensive path ran on every call.
      const store = new Map<string, string>();
      const { service } = buildService({
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        set: jest.fn(async (key: string, value: string) => {
          store.set(key, value);
          return 'OK';
        }),
        del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      });
      const factory = jest.fn(async () => null);

      await expect(service.wrap('key', 30, factory)).resolves.toBeNull();
      await expect(service.wrap('key', 30, factory)).resolves.toBeNull();

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('reads a pre-envelope entry written by an older build', async () => {
      // Those are still in Redis with their original TTL after a deploy.
      const { service } = buildService({ get: jest.fn(async () => '{"id":"p1"}') });
      const factory = jest.fn();

      await expect(service.wrap('key', 30, factory)).resolves.toEqual({ id: 'p1' });
      expect(factory).not.toHaveBeenCalled();
    });

    it('runs the factory once for simultaneous misses, and shares the answer', async () => {
      const store = new Map<string, string>();
      let lockTaken = false;
      const { service } = buildService({
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        set: jest.fn(async (key: string, value: string, _ex?: string, _ttl?: number, nx?: string) => {
          if (nx === 'NX') {
            if (lockTaken) return null;
            lockTaken = true;
            return 'OK';
          }
          store.set(key, value);
          return 'OK';
        }),
        del: jest.fn(async () => 1),
      });

      // The deferred is built before anything runs: `wrap` awaits several Redis
      // calls before it reaches the factory, so a resolver assigned *inside* the
      // factory is still unset at the point the test wants to fire it.
      let resolveFactory!: (value: string) => void;
      const pending = new Promise<string>((resolve) => {
        resolveFactory = resolve;
      });
      const factory = jest.fn(() => pending);

      const first = service.wrap('key', 30, factory);
      const second = service.wrap('key', 30, factory);

      // Let the winner reach the factory and the loser start waiting on it.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(factory).toHaveBeenCalledTimes(1);

      resolveFactory('computed once');

      await expect(first).resolves.toBe('computed once');
      await expect(second).resolves.toBe('computed once');
      // The second caller waited for the first rather than asking the database
      // the same question at the same moment.
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('does the work itself rather than waiting forever on a dead lock holder', async () => {
      const { service } = buildService({
        // Lock is held by someone who will never write the value.
        set: jest.fn(async (_k: string, _v: string, _ex?: string, _ttl?: number, nx?: string) =>
          nx === 'NX' ? null : 'OK',
        ),
      });
      const factory = jest.fn(async () => 'computed anyway');

      await expect(service.wrap('key', 30, factory)).resolves.toBe('computed anyway');
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * These keys decide whether an account is locked out, so the thing that
   * matters is that the counter and its expiry cannot come apart: `INCR` then
   * `EXPIRE` as two commands left a key with no TTL whenever the process died
   * between them, which is a permanent lockout of a real customer caused by a
   * crash.
   */
  describe('incrWithTtl', () => {
    it('returns the count after incrementing', async () => {
      const { service } = buildService({ eval: jest.fn(async () => 4) });

      await expect(service.incrWithTtl('login:a@b.ru', 900)).resolves.toBe(4);
    });

    it('counts and expires in one round trip, never as two commands', async () => {
      const { service, redis } = buildService();

      await service.incrWithTtl('login:a@b.ru', 900);

      expect(redis.eval).toHaveBeenCalledTimes(1);
      // The pair that could be interrupted must not be reachable any more.
      expect(redis.incr).not.toHaveBeenCalled();
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('passes the key and the window to the script', async () => {
      const { service, redis } = buildService();

      await service.incrWithTtl('login:a@b.ru', 900);

      expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'login:a@b.ru', '900');
    });

    it('only sets the window on the first hit, so a flood cannot extend a lockout', async () => {
      const { service, redis } = buildService();

      await service.incrWithTtl('login:a@b.ru', 900);

      const script = String(redis.eval.mock.calls[0]?.[0]);
      expect(script).toMatch(/if n == 1 then/);
      expect(script).toMatch(/EXPIRE/);
    });
  });

  it('exposes the raw client for callers needing commands it does not wrap', () => {
    const { service, redis } = buildService();

    expect(service.client).toBe(redis);
  });
});
