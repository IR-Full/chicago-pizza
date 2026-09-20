import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { NotificationType, OrderStatus, PrismaService } from '@chicago-pizza/prisma';
import { paginate } from '@chicago-pizza/common';
import {
  accountExistsEmail,
  orderStatusEmail,
  passwordResetEmail,
  statusLabel,
  supportReplyEmail,
  verificationEmail,
} from '../templates/email.templates';
import { MailPayload } from './mailer.service';

export const EMAIL_QUEUE = 'email';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue<MailPayload>,
  ) {}

  private clientUrl() {
    return this.config.get<string>('CLIENT_URL')!;
  }

  /**
   * Email delivery goes through BullMQ rather than being awaited inline:
   * a flaky SMTP server must never fail the order that triggered the email.
   */
  private enqueue(payload: MailPayload) {
    return this.emailQueue.add('send', payload, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async handleEmailVerification(data: { email: string; firstName: string; code: string }) {
    const { subject, html } = verificationEmail(data.firstName, data.code);
    await this.enqueue({ to: data.email, subject, html });
  }

  /**
   * The signup form answers identically whether or not the address is taken,
   * so this is where the account's owner — and only the owner — learns that
   * someone tried.
   */
  async handleRegistrationAttempt(data: { email: string; firstName: string }) {
    const { subject, html } = accountExistsEmail(
      data.firstName,
      `${this.clientUrl()}/login`,
      `${this.clientUrl()}/forgot-password`,
    );
    await this.enqueue({ to: data.email, subject, html });
  }

  async handlePasswordReset(data: { email: string; firstName: string; token: string }) {
    const resetUrl = `${this.clientUrl()}/reset-password?token=${encodeURIComponent(data.token)}`;
    const { subject, html } = passwordResetEmail(data.firstName, resetUrl);
    await this.enqueue({ to: data.email, subject, html });
  }

  async handleOrderStatusChanged(data: { orderId: string; userId: string; status: OrderStatus }) {
    const user = await this.prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) return;

    await this.prisma.notification.create({
      data: {
        userId: user.id,
        type: NotificationType.ORDER_STATUS,
        title: `Заказ №${data.orderId.slice(0, 8).toUpperCase()}`,
        body: statusLabel(data.status),
      },
    });

    const orderUrl = `${this.clientUrl()}/orders/${data.orderId}`;
    const { subject, html } = orderStatusEmail(user.firstName, data.orderId, data.status, orderUrl);
    await this.enqueue({ to: user.email, subject, html });
  }

  async handleOrderCreated(data: { orderId: string; userId: string }) {
    await this.handleOrderStatusChanged({ ...data, status: OrderStatus.CREATED });
  }

  async handleTicketMessage(data: { ticketId: string; recipientId: string; subject: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: data.recipientId } });
    if (!user) return;

    await this.prisma.notification.create({
      data: {
        userId: user.id,
        type: NotificationType.SUPPORT_REPLY,
        title: 'Новый ответ поддержки',
        body: `По обращению «${data.subject}» есть новое сообщение`,
      },
    });

    const ticketUrl = `${this.clientUrl()}/support/${data.ticketId}`;
    const { subject, html } = supportReplyEmail(user.firstName, data.subject, ticketUrl);
    await this.enqueue({ to: user.email, subject, html });
  }

  // ── Query API ────────────────────────────────────────────────

  async list(userId: string, page = 1, limit = 20) {
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
    // `unread` rides along with the standard page envelope — the bell needs
    // the count, not just this page's rows.
    return { ...paginate(items, total, { page, limit }), unread };
  }

  async markRead(userId: string, notificationId?: string) {
    await this.prisma.notification.updateMany({
      where: { userId, ...(notificationId ? { id: notificationId } : { isRead: false }) },
      data: { isRead: true },
    });
    return { success: true };
  }

  async subscribePush(userId: string, endpoint: string, keys: Record<string, string>) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId, keys },
      create: { userId, endpoint, keys },
    });
    return { success: true };
  }
}
