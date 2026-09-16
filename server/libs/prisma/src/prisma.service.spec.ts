import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';
import { PrismaModule } from './prisma.module';

/**
 * The service only adds lifecycle wiring on top of PrismaClient, so the
 * client's own methods are stubbed and the wiring is what gets asserted:
 * connect on boot, disconnect on shutdown, log warnings and errors.
 */
function buildService() {
  const service = new PrismaService();

  const handlers = new Map<string, (event: { message: string }) => void>();
  const connect = jest.fn(async () => undefined);
  const disconnect = jest.fn(async () => undefined);

  Object.assign(service, {
    $on: jest.fn((event: string, handler: (e: { message: string }) => void) => handlers.set(event, handler)),
    $connect: connect,
    $disconnect: disconnect,
  });

  return { service, handlers, connect, disconnect };
}

describe('PrismaService', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  it('connects when the module boots', async () => {
    const { service, connect } = buildService();

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('subscribes to the warn and error log events', async () => {
    const { service, handlers } = buildService();

    await service.onModuleInit();

    expect([...handlers.keys()].sort()).toEqual(['error', 'warn']);
  });

  it('routes database warnings and errors into the Nest logger', async () => {
    const { service, handlers } = buildService();

    await service.onModuleInit();
    handlers.get('warn')!({ message: 'slow query' });
    handlers.get('error')!({ message: 'deadlock detected' });

    expect(warn).toHaveBeenCalledWith('slow query');
    expect(error).toHaveBeenCalledWith('deadlock detected');
  });

  it('disconnects on shutdown so the pool is released', async () => {
    const { service, disconnect } = buildService();

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed connection instead of booting half-ready', async () => {
    const { service } = buildService();
    Object.assign(service, { $connect: jest.fn(async () => Promise.reject(new Error('ECONNREFUSED'))) });

    await expect(service.onModuleInit()).rejects.toThrow('ECONNREFUSED');
  });
});

describe('PrismaModule', () => {
  it('provides and exports the service globally', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn() })
      .compile();

    expect(moduleRef.get(PrismaService)).toBeDefined();
    expect(Reflect.getMetadata('__module:global__', PrismaModule)).toBe(true);
  });
});
