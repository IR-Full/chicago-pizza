import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from '@chicago-pizza/prisma';
import { rpcSend } from '@chicago-pizza/common';
import { randomUUID } from 'crypto';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notifications: ClientProxy,
    @Inject('REALTIME_SERVICE') private readonly realtime: ClientProxy,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async deliver() {
    const now = new Date();
    const rows = await this.prisma.eventOutbox.findMany({
      where: {
        deliveredAt: null,
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: { sequence: 'asc' },
      take: 25,
    });
    for (const row of rows) {
      const payloadData = row.payload as Record<string, unknown>;
      const older = await this.prisma.eventOutbox.findFirst({
        where: {
          deliveredAt: null,
          destination: row.destination,
          sequence: { lt: row.sequence },
          payload: { path: ['orderId'], equals: String(payloadData.orderId) },
        },
      });
      if (older) continue;
      const owner = randomUUID();
      const claimed = await this.prisma.eventOutbox.updateMany({
        where: {
          id: row.id,
          deliveredAt: null,
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        },
        data: { leaseUntil: new Date(Date.now() + 60_000), leaseOwner: owner, attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      try {
        const payload = { ...(row.payload as Record<string, unknown>), eventId: row.id };
        await rpcSend(
          row.destination === 'notifications' ? this.notifications : this.realtime,
          row.event,
          payload,
        );
        await this.prisma.eventOutbox.updateMany({
          where: { id: row.id, leaseOwner: owner },
          data: { deliveredAt: new Date(), leaseUntil: null, leaseOwner: null, lastError: null },
        });
      } catch (error) {
        this.logger.error(`Outbox delivery failed: ${row.id}`);
        await this.prisma.eventOutbox.updateMany({
          where: { id: row.id, leaseOwner: owner },
          data: {
            leaseUntil: null,
            leaseOwner: null,
            lastError: String(error).slice(0, 1000),
            nextAttemptAt: new Date(Date.now() + Math.min(3600, 2 ** Math.min(row.attempts + 1, 12)) * 1000),
          },
        });
      }
    }
    // Retain delivered records for incident investigation; pending records never expire.
    await this.prisma.eventOutbox.deleteMany({
      where: { deliveredAt: { lt: new Date(Date.now() - 30 * 86400_000) } },
    });
  }
}
