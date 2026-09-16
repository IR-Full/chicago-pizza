import type { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisIoAdapter } from './redis-io.adapter';

/* eslint-disable @typescript-eslint/no-explicit-any -- socket.io and redis mocks */

const duplicate = jest.fn(() => ({ role: 'sub' }));

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((url: string) => ({ url, duplicate })),
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
    superCreate = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(server as never);
  });

  afterEach(() => superCreate.mockRestore());

  it('opens a publisher and a duplicate subscriber, as the adapter requires', async () => {
    const adapter = new RedisIoAdapter(app, 'redis://cache:6379');

    await adapter.connectToRedis();

    expect(Redis).toHaveBeenCalledWith('redis://cache:6379');
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(createAdapter).toHaveBeenCalledWith(expect.objectContaining({ url: 'redis://cache:6379' }), {
      role: 'sub',
    });
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
