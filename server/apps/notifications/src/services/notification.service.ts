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
import { PushService } from './push.service';

export const EMAIL_QUEUE = 'email';

/**
 * The status changes worth a letter.
 *
 * Every change still writes the in-app notification and fires a push — those
 * are what the bell is for, and they cost the customer nothing. An email is
 * different: it competes with the rest of their inbox, and sending one per
 * transition meant a single order produced six, so the one that actually needs
 * reading arrives looking like the five that did not.
 *
 * These three are the ones a customer would want in writing: the order was
 * taken, it is on its way, it is off. `PREPARING` and `DELIVERED` are things
 * they can already see — on the tracker, or on their doorstep.
 */
const EMAILED_STATUSES: OrderStatus[] = [OrderStatus.CREATED, OrderStatus.ON_DELIVERY, OrderStatus.CANCELLED];

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly push: PushService,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue<MailPayload>,
  ) {}

  private clientUrl() {
    return this.config.get<string>('CLIENT_URL')!;
  }

  /**
   * Email delivery goes through BullMQ rather than being awaited inline:
   * a flaky SMTP server must never fail the order that triggered the email.
   */
  private enqueue(payload: MailPayload, eventId?: string) {
    return this.emailQueue.add('send', payload, {
      ...(eventId ? { jobId: eventId } : {}),
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: eventId ? { age: 30 * 86400 } : 1000,
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

  async handleOrderStatusChanged(data: {
    orderId: string;
    userId: string;
    status: OrderStatus;
    eventId?: string;
  }) {
    const user = await this.prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) return;

    const title = `Заказ №${data.orderId.slice(0, 8).toUpperCase()}`;
    const body = statusLabel(data.status);

    const notification = { userId: user.id, type: NotificationType.ORDER_STATUS, title, body };
    let created = true;
    if (data.eventId) {
      // INSERT ... ON CONFLICT DO NOTHING is atomic even for concurrent consumers.
      // An empty-update Prisma upsert can use a read-then-insert and throw P2002.
      const result = await this.prisma.notification.createMany({
        data: [{ ...notification, eventId: data.eventId }],
        skipDuplicates: true,
      });
      created = result.count > 0;
    } else await this.prisma.notification.create({ data: notification });

    const orderUrl = `${this.clientUrl()}/orders/${data.orderId}`;

    // "Your pizza is on its way" is worth a phone buzzing; that is the whole
    // point of a delivery app being installable. The push is fire-and-forget:
    // the row and the letter are the durable record, so a push service being
    // down must not fail this handler and requeue the email.
    if (created) await this.push.sendToUser(user.id, { title, body, url: orderUrl });

    // The in-app row and the push happen for every move — they are cheap, and
    // the bell is where someone looks when they want detail. A letter is not
    // cheap in the same way: every status change sent one, so an ordinary order
    // put six emails in the customer's inbox on its way from the oven to the
    // door. Six letters about one pizza is how a shop teaches its customers to
    // filter its mail, and the one that matters — "we have cancelled your
    // order" — arrives in the folder they stopped reading.
    if (!EMAILED_STATUSES.includes(data.status)) return;

    const { subject, html } = orderStatusEmail(user.firstName, data.orderId, data.status, orderUrl);
    await this.enqueue({ to: user.email, subject, html }, data.eventId);
  }

  async handleOrderCreated(data: { orderId: string; userId: string; eventId?: string }) {
    await this.handleOrderStatusChanged({ ...data, status: OrderStatus.CREATED });
  }

  async handleTicketMessage(data: { ticketId: string; recipientId: string; subject: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: data.recipientId } });
    if (!user) return;

    const title = 'Новый ответ поддержки';
    const body = `По обращению «${data.subject}» есть новое сообщение`;

    await this.prisma.notification.create({
      data: { userId: user.id, type: NotificationType.SUPPORT_REPLY, title, body },
    });

    const ticketUrl = `${this.clientUrl()}/support/${data.ticketId}`;
    await this.push.sendToUser(user.id, { title, body, url: ticketUrl });
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

  /** The key a browser needs to subscribe; null while Web Push is unconfigured. */
  vapidPublicKey(): { publicKey: string | null } {
    return { publicKey: this.push.applicationServerKey };
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
