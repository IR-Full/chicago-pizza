import { Injectable, Logger } from '@nestjs/common';
import { AdminAction, Prisma, PrismaService } from '@chicago-pizza/prisma';

export interface AuditEntry {
  action: AdminAction;
  /** Null for the system: a scheduled job, or an erasure the customer ran. */
  actorId: string | null;
  targetType: 'user' | 'order' | 'product' | 'category' | 'promocode';
  targetId: string;
  /** Before/after values. Never anything that identifies a person. */
  details?: Prisma.InputJsonValue;
  ip?: string;
}

/**
 * Writes the trail for privileged actions.
 *
 * Order status history was the only record the system kept, so "why is this
 * customer suddenly an administrator" and "who blocked that account" had no
 * answer at all — not months later, and not the same afternoon. These are
 * exactly the actions that need to be explicable, and the first ones a
 * regulator asks about.
 *
 * Failures are logged, never thrown: an audit write that could fail the
 * action it describes would be a new way to break the admin panel, and a
 * missing line is a smaller problem than a blocked customer who could not be
 * unblocked.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          action: entry.action,
          actorId: entry.actorId,
          targetType: entry.targetType,
          targetId: entry.targetId,
          details: entry.details,
          ip: entry.ip,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record ${entry.action} on ${entry.targetType}:${entry.targetId}`,
        (error as Error)?.stack,
      );
    }
  }
}
