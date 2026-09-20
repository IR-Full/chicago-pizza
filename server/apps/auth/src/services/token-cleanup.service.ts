import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@chicago-pizza/prisma';

/** Records are kept this long past their expiry, so a support question about
 *  "why was I signed out" can still be answered from the data. */
const RETENTION_DAYS = 30;

/**
 * Nothing used to delete expired refresh tokens, verification codes or reset
 * tokens: every login and every "resend the code" click added a row that was
 * never read again. On a busy account that is thousands of dead rows a year,
 * all of them indexed.
 */
@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanup(): Promise<{ refreshTokens: number; verificationCodes: number; resetTokens: number }> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const [refreshTokens, verificationCodes, resetTokens] = await Promise.all([
      this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
      this.prisma.emailVerificationCode.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
      this.prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    ]);

    const removed = {
      refreshTokens: refreshTokens.count,
      verificationCodes: verificationCodes.count,
      resetTokens: resetTokens.count,
    };

    const total = removed.refreshTokens + removed.verificationCodes + removed.resetTokens;
    if (total > 0) this.logger.log(`Removed ${total} expired auth records older than ${RETENTION_DAYS} days`);

    return removed;
  }
}
