import { Logger } from '@nestjs/common';
import { TokenCleanupService } from './token-cleanup.service';

function createService(counts = { refresh: 3, codes: 5, resets: 1 }) {
  const prisma: Record<string, any> = {
    refreshToken: { deleteMany: jest.fn(async () => ({ count: counts.refresh })) },
    emailVerificationCode: { deleteMany: jest.fn(async () => ({ count: counts.codes })) },
    passwordResetToken: { deleteMany: jest.fn(async () => ({ count: counts.resets })) },
  };

  return { service: new TokenCleanupService(prisma as never), prisma };
}

const cutoffOf = (mock: jest.Mock) => mock.mock.calls[0][0].where.expiresAt.lt as Date;

describe('TokenCleanupService', () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => log.mockRestore());

  it('deletes expired refresh tokens, verification codes and reset tokens', async () => {
    const { service, prisma } = createService();

    await expect(service.cleanup()).resolves.toEqual({ refreshTokens: 3, verificationCodes: 5, resetTokens: 1 });

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalled();
    expect(prisma.emailVerificationCode.deleteMany).toHaveBeenCalled();
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalled();
  });

  it('keeps records for thirty days past expiry, so support can still explain a logout', async () => {
    const { service, prisma } = createService();

    await service.cleanup();

    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const delegate of ['refreshToken', 'emailVerificationCode', 'passwordResetToken']) {
      expect(cutoffOf(prisma[delegate].deleteMany).getTime()).toBeCloseTo(expected, -4);
    }
  });

  it('never touches a record that is still valid', async () => {
    const { service, prisma } = createService();

    await service.cleanup();

    // Only `expiresAt < cutoff` — an active session must survive the sweep.
    expect(prisma.refreshToken.deleteMany.mock.calls[0][0].where).toEqual({ expiresAt: { lt: expect.any(Date) } });
  });

  it('stays quiet when there was nothing to remove', async () => {
    const { service } = createService({ refresh: 0, codes: 0, resets: 0 });

    await service.cleanup();

    expect(log).not.toHaveBeenCalled();
  });

  it('reports how much it removed', async () => {
    const { service } = createService();

    await service.cleanup();

    expect(log).toHaveBeenCalledWith(expect.stringContaining('9'));
  });

  it('runs on a schedule rather than on request', () => {
    // Registered as a cron job — nothing calls `cleanup()` from a route.
    expect(Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', TokenCleanupService.prototype.cleanup)).toBeDefined();
  });
});
