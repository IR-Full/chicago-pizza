import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { kopecksToRubles } from '@chicago-pizza/common';

const API_URL = 'https://api.yookassa.ru/v3';

/** Long enough for a slow bank page, short enough not to hang a checkout. */
const TIMEOUT_MS = 15_000;

export interface CreatedPayment {
  providerPaymentId: string;
  /** Where to send the customer to finish paying. */
  confirmationUrl: string;
}

export interface CreatedRefund {
  providerRefundId: string;
  /** The provider's own word for where the refund got to. */
  status: string;
  /** Kopecks actually sent back. */
  amount: number;
}

export interface ProviderPayment {
  providerPaymentId: string;
  /** The provider's own vocabulary, mapped in `PaymentService`. */
  status: string;
  paid: boolean;
  /** Kopecks, converted back from the roubles the API speaks. */
  amount: number;
}

interface YooKassaPayment {
  id: string;
  status: string;
  paid: boolean;
  amount: { value: string; currency: string };
  confirmation?: { confirmation_url?: string };
}

interface YooKassaRefund {
  id: string;
  status: string;
  amount: { value: string; currency: string };
}

/**
 * YooKassa, which is how a Russian shop takes a card or an SBP transfer.
 *
 * Optional, like the Web Push keys: without credentials the provider reports
 * itself unconfigured, online payment is not offered, and paying the courier
 * carries on as the only option. A shop without a merchant account still runs.
 *
 * Nothing here trusts a webhook body. A notification is only ever a hint that
 * something changed; the truth is re-read from the API, because a POST to a
 * public URL is something anyone can send.
 */
@Injectable()
export class YooKassaProvider {
  private readonly logger = new Logger(YooKassaProvider.name);

  constructor(private readonly config: ConfigService) {}

  get isEnabled(): boolean {
    return Boolean(this.shopId && this.secretKey);
  }

  private get shopId(): string | undefined {
    return this.config.get<string>('YOOKASSA_SHOP_ID');
  }

  private get secretKey(): string | undefined {
    return this.config.get<string>('YOOKASSA_SECRET_KEY');
  }

  /**
   * Opens a payment and returns where to send the customer.
   *
   * `idempotenceKey` is the order's own id: a retried checkout must reuse the
   * payment it already opened rather than opening a second one against the
   * same order — which is the provider's own rule as much as ours.
   */
  async create(params: {
    orderId: string;
    amount: number;
    description: string;
    returnUrl: string;
  }): Promise<CreatedPayment> {
    const payment = await this.request<YooKassaPayment>('/payments', {
      method: 'POST',
      idempotenceKey: params.orderId,
      body: {
        amount: { value: kopecksToRubles(params.amount).toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: params.returnUrl },
        description: params.description,
        metadata: { orderId: params.orderId },
      },
    });

    const confirmationUrl = payment.confirmation?.confirmation_url;
    if (!confirmationUrl) {
      // Without somewhere to send the customer the payment cannot be
      // completed, so treat it as a failure rather than storing a dead row.
      throw new ServiceUnavailableException('Платёж не создан: нет ссылки на оплату');
    }

    return { providerPaymentId: payment.id, confirmationUrl };
  }

  /** Re-reads a payment. The only statement about money this service trusts. */
  async fetch(providerPaymentId: string): Promise<ProviderPayment> {
    const payment = await this.request<YooKassaPayment>(`/payments/${providerPaymentId}`, { method: 'GET' });

    return {
      providerPaymentId: payment.id,
      status: payment.status,
      paid: payment.paid,
      // The API speaks roubles with two decimals; everything here is kopecks.
      amount: Math.round(Number(payment.amount.value) * 100),
    };
  }

  /**
   * Sends the money back.
   *
   * `idempotenceKey` is derived from the order, not generated per call: a
   * refund is the one operation that must never happen twice, and the network
   * will retry it whether or not we want it to. Asking the provider to
   * deduplicate is stronger than remembering not to ask again, because our own
   * record of having asked is exactly what a crash loses.
   */
  async refund(params: {
    providerPaymentId: string;
    amount: number;
    orderId: string;
  }): Promise<CreatedRefund> {
    const refund = await this.request<YooKassaRefund>('/refunds', {
      method: 'POST',
      idempotenceKey: `refund-${params.orderId}`,
      body: {
        payment_id: params.providerPaymentId,
        amount: { value: kopecksToRubles(params.amount).toFixed(2), currency: 'RUB' },
      },
    });

    return {
      providerRefundId: refund.id,
      status: refund.status,
      amount: Math.round(Number(refund.amount.value) * 100),
    };
  }

  private async request<T>(
    path: string,
    options: { method: 'GET' | 'POST'; body?: unknown; idempotenceKey?: string },
  ): Promise<T> {
    if (!this.isEnabled) throw new ServiceUnavailableException('Онлайн-оплата не настроена');

    const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${API_URL}${path}`, {
        method: options.method,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          // Required on every POST; the provider deduplicates by it.
          ...(options.idempotenceKey ? { 'Idempotence-Key': options.idempotenceKey } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        // The provider's own message is not shown to the customer: it is
        // written for an integrator and may name internal details.
        this.logger.error(`YooKassa ${options.method} ${path} → ${response.status}`);
        throw new ServiceUnavailableException('Платёжный сервис недоступен, попробуйте позже');
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`YooKassa ${options.method} ${path} failed`, error as Error);
      throw new ServiceUnavailableException('Платёжный сервис недоступен, попробуйте позже');
    } finally {
      clearTimeout(timer);
    }
  }
}
