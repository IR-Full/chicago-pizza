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
    ...overrides,
  };

  return { service: new RedisCacheService(redis as unknown as Redis), redis };
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
      const { service } = buildService({ get: jest.fn(async () => '["cached"]') });
      const factory = jest.fn();

      await expect(service.wrap('key', 30, factory)).resolves.toEqual(['cached']);
      expect(factory).not.toHaveBeenCalled();
    });

    it('computes, stores and returns a miss', async () => {
      const { service, redis } = buildService();
      const factory = jest.fn(async () => ({ fresh: true }));

      await expect(service.wrap('key', 30, factory)).resolves.toEqual({ fresh: true });
      expect(redis.set).toHaveBeenCalledWith('key', '{"fresh":true}', 'EX', 30);
    });

    it('does not swallow a factory failure', async () => {
      const { service, redis } = buildService();

      await expect(service.wrap('key', 30, async () => Promise.reject(new Error('db down')))).rejects.toThrow('db down');
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('incrWithTtl', () => {
    it('sets the window on the first hit', async () => {
      const { service, redis } = buildService({ incr: jest.fn(async () => 1) });

      await expect(service.incrWithTtl('login:a@b.ru', 900)).resolves.toBe(1);
      expect(redis.expire).toHaveBeenCalledWith('login:a@b.ru', 900);
    });

    it('leaves the window alone on later hits so it stays sliding-from-first', async () => {
      const { service, redis } = buildService({ incr: jest.fn(async () => 4) });

      await expect(service.incrWithTtl('login:a@b.ru', 900)).resolves.toBe(4);
      expect(redis.expire).not.toHaveBeenCalled();
    });
  });

  it('exposes the raw client for callers needing commands it does not wrap', () => {
    const { service, redis } = buildService();

    expect(service.client).toBe(redis);
  });
});
