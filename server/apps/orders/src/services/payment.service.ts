import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { OrderStatus, PaymentStatus, PrismaService } from '@chicago-pizza/prisma';
import { RMQ_EVENTS, shortId } from '@chicago-pizza/common';
import { YooKassaProvider } from './yookassa.provider';

const PROVIDER = 'yookassa';

/**
 * The provider's vocabulary, mapped onto ours.
 *
 * `waiting_for_capture` is a payment held pending an explicit capture. The
 * checkout asks for automatic capture, so it should not appear — but a status
 * the mapping does not know must not silently become "paid", so it maps to
 * pending and the order simply waits.
 */
const STATUS_MAP: Record<string, PaymentStatus> = {
  pending: PaymentStatus.PENDING,
  waiting_for_capture: PaymentStatus.PENDING,
  succeeded: PaymentStatus.SUCCEEDED,
  canceled: PaymentStatus.CANCELLED,
};

/**
 * Money for an order.
 *
 * Two rules hold everything else up. Nothing a webhook says is believed — a
 * notification is a hint that something changed, and the state is re-read from
 * the provider, because a POST to a public URL is something anyone can send.
 * And the amount the provider reports is checked against the order's own
 * total, so a payment for 1 ₽ can never mark a 1 500 ₽ order paid.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly provider: YooKassaProvider,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notifications: ClientProxy,
    @Inject('REALTIME_SERVICE') private readonly realtime: ClientProxy,
  ) {}

  get isEnabled(): boolean {
    return this.provider.isEnabled;
  }

  /**
   * Opens a payment for an order and returns where to send the customer.
   *
   * Reuses an existing pending payment rather than opening a second one: a
   * customer who closes the bank page and presses "pay" again is continuing
   * the same attempt, not starting a new one.
   */
  async startPayment(userId: string, orderId: string): Promise<{ confirmationUrl: string }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { payment: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.status === OrderStatus.CANCELLED) throw new BadRequestException('Заказ отменён');

    if (order.payment?.status === PaymentStatus.SUCCEEDED) {
      throw new BadRequestException('Заказ уже оплачен');
    }

    if (order.payment?.confirmationUrl && order.payment.status === PaymentStatus.PENDING) {
      return { confirmationUrl: order.payment.confirmationUrl };
    }

    const created = await this.provider.create({
      orderId: order.id,
      amount: order.total,
      description: `Заказ №${order.id.slice(0, 8).toUpperCase()}`,
      returnUrl: `${this.config.get<string>('CLIENT_URL')}/orders/${order.id}`,
    });

    await this.prisma.payment.upsert({
      where: { orderId: order.id },
      update: {
        providerPaymentId: created.providerPaymentId,
        confirmationUrl: created.confirmationUrl,
        status: PaymentStatus.PENDING,
        amount: order.total,
      },
      create: {
        orderId: order.id,
        provider: PROVIDER,
        providerPaymentId: created.providerPaymentId,
        confirmationUrl: created.confirmationUrl,
        amount: order.total,
      },
    });

    return { confirmationUrl: created.confirmationUrl };
  }

  /**
   * Acts on a notification from the provider.
   *
   * The body is used for one thing only — which payment to go and look at.
   * Everything that matters is re-read over an authenticated call.
   */
  async handleNotification(providerPaymentId: string): Promise<{ handled: boolean }> {
    const payment = await this.prisma.payment.findUnique({ where: { providerPaymentId } });
    if (!payment) {
      // Not ours, or not ours yet. Answering 200 anyway stops the provider
      // retrying a notification nobody here can act on.
      this.logger.warn(`Notification for unknown payment ${shortId(providerPaymentId)}`);
      return { handled: false };
    }

    const remote = await this.provider.fetch(providerPaymentId);
    const status = STATUS_MAP[remote.status] ?? PaymentStatus.PENDING;

    if (status === PaymentStatus.SUCCEEDED) {
      // A payment for less than the order is not payment for the order.
      if (remote.amount !== payment.amount) {
        this.logger.error(
          `Payment ${shortId(providerPaymentId)} reports ${remote.amount} against ${payment.amount}`,
        );
        return { handled: false };
      }
      return this.markPaid(payment.id, payment.orderId);
    }

    await this.prisma.payment.update({ where: { id: payment.id }, data: { status } });
    return { handled: true };
  }

  /**
   * Books the money and moves the order on.
   *
   * Conditional on the payment still being pending, so a provider that sends
   * the same notification twice — which they do — cannot accept the order
   * twice or announce it twice.
   */
  private async markPaid(paymentId: string, orderId: string): Promise<{ handled: boolean }> {
    const { count } = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.SUCCEEDED, paidAt: new Date() },
    });
    if (count === 0) return { handled: false };

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    // A paid order is one the kitchen may start on. Only from CREATED: an
    // order already moving on has been accepted by a human, and a late
    // notification must not drag it backwards.
    if (order.status === OrderStatus.CREATED) {
      await this.prisma.order.updateMany({
        where: { id: orderId, status: OrderStatus.CREATED },
        data: { status: OrderStatus.ACCEPTED },
      });
      await this.prisma.orderStatusHistory.create({
        data: { orderId, status: OrderStatus.ACCEPTED, changedById: null },
      });
    }

    const event = {
      orderId,
      userId: order.userId,
      status: OrderStatus.ACCEPTED,
      total: order.total,
      updatedAt: new Date(),
    };
    this.notifications.emit(RMQ_EVENTS.ORDER_STATUS_CHANGED, event);
    this.realtime.emit(RMQ_EVENTS.ORDER_STATUS_CHANGED, event);

    return { handled: true };
  }

  /** What the order page needs to know: is this paid, and where to pay if not. */
  async statusFor(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { payment: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    return {
      required: order.paymentMethod === 'ONLINE',
      status: order.payment?.status ?? null,
      confirmationUrl:
        order.payment?.status === PaymentStatus.PENDING ? order.payment.confirmationUrl : null,
    };
  }
}
