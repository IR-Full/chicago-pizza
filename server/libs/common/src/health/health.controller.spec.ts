import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '@chicago-pizza/prisma';
import { HealthController } from './health.controller';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

function buildController(checkResult: unknown = { status: 'ok', info: { database: { status: 'up' } } }) {
  const health = { check: jest.fn(async (indicators: (() => unknown)[]) => {
    // Run the indicator so a broken ping surfaces here too.
    await Promise.all(indicators.map((indicator) => indicator()));
    return checkResult;
  }) } as unknown as HealthCheckService;
  const indicator = { pingCheck: jest.fn(async () => ({ database: { status: 'up' } })) } as unknown as PrismaHealthIndicator;
  const prisma = {} as PrismaService;

  return { controller: new HealthController(health, indicator, prisma), health, indicator, prisma };
}

describe('HealthController', () => {
  it('answers liveness without touching the database', () => {
    const { controller, indicator } = buildController();

    expect(controller.liveness()).toEqual({ status: 'ok' });
    expect(indicator.pingCheck).not.toHaveBeenCalled();
  });

  it('pings the database for readiness', async () => {
    const { controller, indicator, prisma } = buildController();

    await controller.readiness();

    expect(indicator.pingCheck).toHaveBeenCalledWith('database', prisma);
  });

  it('returns the terminus report', async () => {
    const { controller } = buildController({ status: 'ok', info: { database: { status: 'up' } } });

    await expect(controller.readiness()).resolves.toMatchObject({ status: 'ok' });
  });

  it('propagates a failing readiness check so the orchestrator restarts the pod', async () => {
    const health = { check: jest.fn(async () => Promise.reject(new Error('database unreachable'))) } as unknown as HealthCheckService;
    const controller = new HealthController(health, { pingCheck: jest.fn() } as unknown as PrismaHealthIndicator, {} as PrismaService);

    await expect(controller.readiness()).rejects.toThrow('database unreachable');
  });

  it.each([['liveness'], ['readiness']])('keeps %s reachable without a token', (route) => {
    const handler = HealthController.prototype[route as 'liveness' | 'readiness'];

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
  });
});
