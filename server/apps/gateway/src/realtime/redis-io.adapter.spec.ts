import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisIoAdapter } from './redis-io.adapter';

// `connectToRedis` pings both clients before handing them to the adapter, so
// a wrong REDIS_URL fails the startup instead of surfacing much later as
// broadcasts that silently never cross between gateway replicas.
const ping = jest.fn(async () => 'PONG');
const duplicate = jest.fn(() => ({ role: 'sub', ping }));

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((url: string) => ({ url, duplicate, ping })),
}));

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(() => 'adapter-constructor'),
}));

const app = {} as INestApplication;

describe('RedisIoAdapter', () => {
  let superCreate: jest.SpyInstance;
  const server = { adapter: jest.fn() };

  beforeEach(() => {
    (Redis as unknown as jest.Mock).mockClear();
    (createAdapter as jest.Mock).mockClear();
    server.adapter.mockClear();
    ping.mockClear();
    superCreate = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(server as never);
  });

  afterEach(() => superCreate.mockRestore());

  it('opens a publisher and a duplicate subscriber, as the adapter requires', async () => {
    const adapter = new RedisIoAdapter(app, 'redis://cache:6379');

    await adapter.connectToRedis();

    expect(Redis).toHaveBeenCalledWith('redis://cache:6379');
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(createAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'redis://cache:6379' }),
      expect.objectContaining({ role: 'sub' }),
    );
  });

  it('waits for both clients before declaring itself connected', async () => {
    const adapter = new RedisIoAdapter(app, 'redis://cache:6379');

    await adapter.connectToRedis();

    // ioredis connects lazily, so returning without this left a wrong
    // REDIS_URL to surface much later, as broadcasts that went nowhere.
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('fails the startup when Redis cannot be reached', async () => {
    ping.mockRejectedValueOnce(new Error('ECONNREFUSED') as never);
    const adapter = new RedisIoAdapter(app, 'redis://unreachable:6379');

    await expect(adapter.connectToRedis()).rejects.toThrow('ECONNREFUSED');
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it('attaches the adapter to the server it creates', async () => {
    const adapter = new RedisIoAdapter(app, 'redis://cache:6379');
    await adapter.connectToRedis();

    const created = adapter.createIOServer(3000, { path: '/socket.io' } as never);

    expect(superCreate).toHaveBeenCalledWith(3000, { path: '/socket.io' });
    expect(server.adapter).toHaveBeenCalledWith('adapter-constructor');
    expect(created).toBe(server);
  });

  it('still serves a single replica when Redis was never connected', () => {
    // Without this branch, a local run without Redis would crash on boot.
    const adapter = new RedisIoAdapter(app, 'redis://cache:6379');

    const created = adapter.createIOServer(3000);

    expect(server.adapter).not.toHaveBeenCalled();
    expect(created).toBe(server);
  });
});
