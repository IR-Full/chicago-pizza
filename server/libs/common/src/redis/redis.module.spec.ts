import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { RedisModule } from './redis.module';
import { REDIS_CLIENT } from './redis.constants';
import { RedisCacheService } from './redis-cache.service';

// No real connection is wanted in a unit test; the constructor call itself is
// what we assert on.
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((url: string) => ({ url, quit: jest.fn() })),
}));

async function compile(redisUrl: string | undefined = 'redis://cache:6379') {
  return Test.createTestingModule({ imports: [RedisModule] })
    .overrideProvider(ConfigService)
    .useValue({ get: jest.fn(() => redisUrl) })
    .compile();
}

describe('RedisModule', () => {
  beforeEach(() => (Redis as unknown as jest.Mock).mockClear());

  it('builds the client from REDIS_URL', async () => {
    const moduleRef = await compile('redis://cache:6379');

    expect(Redis).toHaveBeenCalledWith('redis://cache:6379');
    expect(moduleRef.get(REDIS_CLIENT)).toMatchObject({ url: 'redis://cache:6379' });
  });

  it('exposes the cache service wired to that client', async () => {
    const moduleRef = await compile();
    const service = moduleRef.get(RedisCacheService);

    expect(service).toBeInstanceOf(RedisCacheService);
    expect(service.client).toBe(moduleRef.get(REDIS_CLIENT));
  });

  it('is global so services need not import it explicitly', () => {
    expect(Reflect.getMetadata('__module:global__', RedisModule)).toBe(true);
  });
});
