import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@chicago-pizza/prisma';
import { shortId } from '@chicago-pizza/common';
import webpush from 'web-push';

/** What lands on the lock screen. Kept small — the payload is encrypted per subscription. */
export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping it should take the customer. */
  url: string;
}

/**
 * Status codes a push service returns for a subscription that is gone for
 * good: the browser was uninstalled, the permission revoked, the key rotated.
 * Anything else — a timeout, a 500 — might work next time and is left alone.
 */
const SUBSCRIPTION_GONE = [404, 410];

/**
 * Browser notifications.
 *
 * The plumbing for these was all in place and unused: the service worker has
 * had a `push` handler from the start, subscriptions were being stored, and
 * nothing ever sent anything. This is the sender.
 *
 * Without VAPID keys it stays switched off rather than failing: a shop that
 * has not generated a pair yet still gets emails, stored notifications and
 * live WebSocket updates.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private publicKey: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');

    if (!publicKey || !privateKey) {
      this.logger.log('Web Push disabled: no VAPID keys configured');
      return;
    }

    webpush.setVapidDetails(this.config.get<string>('VAPID_SUBJECT')!, publicKey, privateKey);
    this.publicKey = publicKey;
    this.logger.log('Web Push enabled');
  }

  /**
   * The key the browser needs to subscribe. Served to the client at runtime
   * rather than baked into the bundle, so rotating it does not need a rebuild.
   */
  get applicationServerKey(): string | null {
    return this.publicKey;
  }

  get isEnabled(): boolean {
    return this.publicKey !== null;
  }

  /**
   * Pushes to every device the customer has subscribed, and forgets the ones
   * that no longer exist.
   *
   * One dead subscription must not silence the others, so the sends are
   * settled independently — a customer with a stale desktop subscription and
   * a live phone should still get it on the phone.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<{ sent: number }> {
    if (!this.isEnabled) return { sent: 0 };

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (!subscriptions.length) return { sent: 0 };

    const body = JSON.stringify(payload);
    const gone: string[] = [];
    let sent = 0;

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: subscription.keys as unknown as { p256dh: string; auth: string },
            },
            body,
          );
          sent += 1;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status && SUBSCRIPTION_GONE.includes(status)) {
            gone.push(subscription.endpoint);
            return;
          }
          // A transient failure is not worth failing the caller over: the
          // notification row and the email have already gone out.
          this.logger.warn(`Push to ${shortId(userId)} failed with ${status ?? 'no status'}`);
        }
      }),
    );

    if (gone.length) {
      // Left in place these accumulate forever and every send pays for them.
      await this.prisma.pushSubscription.deleteMany({ where: { endpoint: { in: gone } } });
      this.logger.debug(`Dropped ${gone.length} dead subscription(s) of ${shortId(userId)}`);
    }

    return { sent };
  }
}
