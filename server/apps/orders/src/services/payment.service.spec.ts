import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentService } from './payment.service';

const ORDER = {
  id: 'order-1',
  userId: 'user-1',
  total: 78_000,
  status: 'CREATED',
  paymentMethod: 'ONLINE',
  payment: null as Record<string, unknown> | null,
};

interface Fixture {
  order?: Record<string, unknown> | null;
  payment?: Record<string, unknown> | null;
  /** What the provider says when the payment is re-read. */
  remote?: { status: string; paid: boolean; amount: number };
  /** Rows the conditional "mark paid" update matched. */
  paidCount?: number;
  /** Rows the conditional "mark refunded" update matched. */
  refundedCount?: number;
  enabled?: boolean;
  receiptEnabled?: boolean;
}

function createService(fixture: Fixture = {}) {
  const storedPayment: any = fixture.payment
    ? { ...fixture.payment, order: fixture.order ?? { ...ORDER, status: 'CANCELLED' } }
    : null;
  const prisma: any = {
    $queryRaw: jest.fn(async () => []),
    eventOutbox: { createMany: jest.fn(async () => ({ count: 2 })) },
    order: {
      findFirst: jest.fn(async () => (fixture.order === undefined ? ORDER : fixture.order)),
      findUniqueOrThrow: jest.fn(async () => (fixture.order === undefined ? ORDER : fixture.order)),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({ count: 1 })),
    },
    orderStatusHistory: { create: jest.fn(async () => ({})) },
    payment: {
      findUnique: jest.fn(async () => storedPayment),
      upsert: jest.fn(async () => ({ id: 'payment-1' })),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async ({ data }: { data: { status: string } }) => {
        const count = data.status === 'REFUNDED' ? (fixture.refundedCount ?? 1) : (fixture.paidCount ?? 1);
        if (count && storedPayment) Object.assign(storedPayment, data);
        return { count };
      }),
    },
  };

  prisma.$transaction = jest.fn(async (fn: (tx: any) => unknown) => fn(prisma));
  const provider = {
    isEnabled: fixture.enabled ?? true,
    create: jest.fn(async () => ({
      providerPaymentId: 'yk-1',
      confirmationUrl: 'https://pay.example/yk-1',
    })),
    fetch: jest.fn(async () => ({
      providerPaymentId: 'yk-1',
      currency: 'RUB',
      status: fixture.remote?.status ?? 'succeeded',
      paid: fixture.remote?.paid ?? true,
      amount: fixture.remote?.amount ?? 78_000,
    })),
    fetchRefund: jest.fn(async () => ({
      providerRefundId: 'yk-refund-1',
      status: 'succeeded',
      amount: 78_000,
    })),
    refund: jest.fn(async () => ({ providerRefundId: 'yk-refund-1', status: 'succeeded', amount: 78_000 })),
  };

  const config = {
    get: jest.fn(
      (name: string) =>
        (
          ({
            CLIENT_URL: 'https://chicago-pizza.ru',
            YOOKASSA_RECEIPT_ENABLED: fixture.receiptEnabled ? 'true' : 'false',
            YOOKASSA_VAT_CODE: 1,
          }) as Record<string, unknown>
        )[name],
    ),
  };
  const notifications = { emit: jest.fn() };
  const realtime = { emit: jest.fn() };

  return {
    service: new PaymentService(
      prisma as never,
      config as never,
      provider as never,
      notifications as never,
      realtime as never,
    ),
    prisma,
    provider,
    notifications,
    realtime,
  };
}

describe('PaymentService — opening a payment', () => {
  it('stores the receipt sent with a payment for later refunds', async () => {
    const { service, provider, prisma } = createService({
      receiptEnabled: true,
      order: {
        ...ORDER,
        deliveryFee: 15000,
        user: { email: 'buyer@example.ru' },
        items: [
          { productName: 'Пицца', sizeLabel: '45 см', variantName: null, quantity: 1, totalPrice: 63000 },
        ],
      },
    });
    await service.startPayment('user-1', 'order-1');
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        receipt: expect.objectContaining({ customer: { email: 'buyer@example.ru' } }),
      }),
    );
    expect(prisma.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          receipt: expect.objectContaining({ customer: { email: 'buyer@example.ru' } }),
        }),
      }),
    );
  });
  it('returns somewhere for the customer to pay', async () => {
    const { service, provider } = createService();

    await expect(service.startPayment('user-1', 'order-1')).resolves.toEqual({
      confirmationUrl: 'https://pay.example/yk-1',
    });
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', amount: 78_000 }),
    );
  });

  /**
   * A customer who closes the bank page and presses "pay" again is continuing
   * the same attempt. Opening a second payment would leave two live ones
   * against one order.
   */
  it('reuses a payment that is still waiting', async () => {
    const { service, provider } = createService({
      order: { ...ORDER, payment: { status: 'PENDING', confirmationUrl: 'https://pay.example/old' } },
    });

    await expect(service.startPayment('user-1', 'order-1')).resolves.toEqual({
      confirmationUrl: 'https://pay.example/old',
    });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('refuses to charge for an order that is already paid', async () => {
    const { service } = createService({ order: { ...ORDER, payment: { status: 'SUCCEEDED' } } });

    await expect(service.startPayment('user-1', 'order-1')).rejects.toThrow(/уже оплачен/);
  });

  it('refuses to charge for a cancelled order', async () => {
    const { service } = createService({ order: { ...ORDER, status: 'CANCELLED' } });

    await expect(service.startPayment('user-1', 'order-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('starts a new idempotent attempt after the bank cancelled the previous payment', async () => {
    const { service, provider, prisma } = createService({
      order: { ...ORDER, payment: { status: 'CANCELLED', providerPaymentId: 'old-payment' } },
    });
    await service.startPayment('user-1', 'order-1');
    const key = (provider.create.mock.calls as unknown as [{ idempotenceKey: string }][])[0][0];
    expect(key.idempotenceKey).toMatch(/^[a-f0-9]{64}$/);
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'order-1', status: 'CANCELLED', providerPaymentId: 'old-payment' },
        data: expect.objectContaining({ status: 'PENDING', providerPaymentId: 'yk-1' }),
      }),
    );
  });

  it('refuses another charge after a refund', async () => {
    const { service, provider } = createService({ order: { ...ORDER, payment: { status: 'REFUNDED' } } });
    await expect(service.startPayment('user-1', 'order-1')).rejects.toThrow();
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('will not open a payment against someone else’s order', async () => {
    const { service } = createService({ order: null });

    await expect(service.startPayment('user-1', 'order-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * A POST to a public URL is something anyone can send. The body is used for
 * exactly one thing — which payment to go and look at — and every fact comes
 * from an authenticated read.
 */
describe('PaymentService — acting on a notification', () => {
  const pending = { id: 'payment-1', orderId: 'order-1', amount: 78_000, status: 'PENDING' };

  it('re-reads the payment instead of believing the notification', async () => {
    const { service, provider } = createService({ payment: pending });

    await service.handleNotification('yk-1');

    expect(provider.fetch).toHaveBeenCalledWith('yk-1');
  });

  it('marks the order accepted once the money is really there', async () => {
    const { service, prisma } = createService({ payment: pending });

    await expect(service.handleNotification('yk-1')).resolves.toEqual({ handled: true });

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACCEPTED' } }),
    );
  });

  it('persists payment acceptance events in the same transaction', async () => {
    const { service, prisma } = createService({ payment: pending });
    await service.handleNotification('yk-1');
    expect(prisma.eventOutbox.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          destination: 'notifications',
          payload: expect.objectContaining({ status: 'ACCEPTED' }),
        }),
        expect.objectContaining({ destination: 'realtime' }),
      ]),
    });
  });

  /** A payment for 1 ₽ must never settle a 1 500 ₽ order. */
  it('refuses a payment whose amount does not match the order', async () => {
    const { service, prisma } = createService({
      payment: pending,
      remote: { status: 'succeeded', paid: true, amount: 100 },
    });

    await expect(service.handleNotification('yk-1')).resolves.toEqual({ handled: false });
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing twice when the provider sends the same notification again', async () => {
    const { service, prisma } = createService({ payment: pending, paidCount: 0 });

    // Providers do resend. The conditional update is what makes that harmless.
    await expect(service.handleNotification('yk-1')).resolves.toEqual({ handled: false });
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('records a cancellation without touching the order', async () => {
    const { service, prisma } = createService({
      payment: pending,
      remote: { status: 'canceled', paid: false, amount: 78_000 },
    });

    await service.handleNotification('yk-1');

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED' } }),
    );
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  /**
   * A status the mapping does not know must never become "paid" by default —
   * that is the one direction where guessing costs money.
   */
  it('treats an unknown provider status as still pending', async () => {
    const { service, prisma } = createService({
      payment: pending,
      remote: { status: 'something_new', paid: true, amount: 78_000 },
    });

    await service.handleNotification('yk-1');

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING' } }),
    );
  });

  it('shrugs at a notification for a payment it has never heard of', async () => {
    const { service, provider } = createService({ payment: null });

    await expect(service.handleNotification('yk-unknown')).resolves.toEqual({ handled: false });
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('leaves an order that a human has already moved on', async () => {
    const { service, prisma } = createService({
      payment: pending,
      order: { ...ORDER, status: 'PREPARING' },
    });

    // A late notification must not drag a cooking order back to ACCEPTED.
    await service.handleNotification('yk-1');

    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });
});

describe('PaymentService — what the order page asks', () => {
  it('reports a pending payment with somewhere to finish it', async () => {
    const { service } = createService({
      order: {
        ...ORDER,
        payment: { status: 'PENDING', confirmationUrl: 'https://pay.example/yk-1' },
      },
    });

    await expect(service.statusFor('user-1', 'order-1')).resolves.toEqual({
      required: true,
      status: 'PENDING',
      confirmationUrl: 'https://pay.example/yk-1',
    });
  });

  it('offers no link once the money has arrived', async () => {
    const { service } = createService({
      order: { ...ORDER, payment: { status: 'SUCCEEDED', confirmationUrl: 'https://pay.example/yk-1' } },
    });

    await expect(service.statusFor('user-1', 'order-1')).resolves.toMatchObject({
      status: 'SUCCEEDED',
      confirmationUrl: null,
    });
  });

  it('says nothing is required for an order paid at the door', async () => {
    const { service } = createService({
      order: { ...ORDER, paymentMethod: 'CASH_ON_DELIVERY', payment: null },
    });

    await expect(service.statusFor('user-1', 'order-1')).resolves.toMatchObject({
      required: false,
      status: null,
    });
  });
});

describe('PaymentService — without a merchant account', () => {
  it('reports itself unavailable rather than pretending', async () => {
    const { service } = createService({ enabled: false });

    expect(service.isEnabled).toBe(false);
  });
});

/**
 * Cancelling returned the loyalty points and freed the promocode — the two
 * things the shop had never actually been paid — and said nothing about the
 * money it had. `PaymentStatus.REFUNDED` sat in the schema, used by nothing.
 */
describe('PaymentService — giving the money back', () => {
  const paid = {
    id: 'payment-1',
    orderId: 'order-1',
    providerPaymentId: 'yk-1',
    amount: 78_000,
    status: 'SUCCEEDED',
  };

  it('refunds a payment that actually went through', async () => {
    const { service, provider } = createService({ payment: paid });

    await expect(service.refundForCancelledOrder('order-1')).resolves.toEqual({
      refunded: true,
      amount: 78_000,
    });
    expect(provider.refund).toHaveBeenCalledWith({
      providerPaymentId: 'yk-1',
      amount: 78_000,
      orderId: 'order-1',
    });
  });

  it('marks the payment refunded, conditionally on it still being paid', async () => {
    const { service, prisma } = createService({ payment: paid });

    await service.refundForCancelledOrder('order-1');

    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'SUCCEEDED' },
      data: { status: 'REFUNDED', providerRefundId: 'yk-refund-1', refundStatus: 'succeeded' },
    });
  });

  it('does nothing for an order that was never paid online', async () => {
    const { service, provider } = createService({ payment: null });

    await expect(service.refundForCancelledOrder('order-1')).resolves.toEqual({
      refunded: false,
      amount: 0,
    });
    expect(provider.refund).not.toHaveBeenCalled();
  });

  it('does nothing for a payment the customer abandoned', async () => {
    const { service, provider } = createService({ payment: { ...paid, status: 'PENDING' } });

    await expect(service.refundForCancelledOrder('order-1')).resolves.toEqual({
      refunded: false,
      amount: 0,
    });
    expect(provider.refund).not.toHaveBeenCalled();
  });

  it('refuses to report a second refund when another cancellation got there first', async () => {
    const { service } = createService({ payment: paid, refundedCount: 0 });

    await expect(service.refundForCancelledOrder('order-1')).resolves.toEqual({
      refunded: false,
      amount: 0,
    });
  });

  /**
   * The order matters: marking the row first would mean a failed call left an
   * order recorded as refunded with the money still here — the one error in
   * this direction nobody would ever notice.
   */
  it('leaves the payment marked paid when the provider refuses', async () => {
    const { service, prisma, provider } = createService({ payment: paid });
    provider.refund.mockRejectedValue(new Error('provider down'));

    await expect(service.refundForCancelledOrder('order-1')).rejects.toThrow();
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });
});

describe('PaymentService — deployment safety', () => {
  const payment = {
    id: 'payment-1',
    orderId: 'order-1',
    providerPaymentId: 'yk-1',
    amount: 78_000,
    status: 'PENDING',
  };
  it('refunds a payment arriving after cancellation without announcing acceptance', async () => {
    const { service, provider, prisma } = createService({
      payment,
      order: { ...ORDER, status: 'CANCELLED' },
    });
    await service.handleNotification('yk-1');
    expect(provider.refund).toHaveBeenCalled();
    expect(prisma.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(prisma.eventOutbox.createMany).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REFUNDED' }) }),
    );
  });
  it('does not mark a pending refund as completed', async () => {
    const { service, provider, prisma } = createService({ payment: { ...payment, status: 'SUCCEEDED' } });
    provider.refund.mockResolvedValue({ providerRefundId: 'refund-1', status: 'pending', amount: 78_000 });
    expect(await service.refundForCancelledOrder('order-1')).toEqual({ refunded: false, amount: 0 });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { providerRefundId: 'refund-1', refundStatus: 'pending' } }),
    );
  });
  it('polls the stored refund instead of creating another one', async () => {
    const { service, provider } = createService({
      payment: { ...payment, status: 'SUCCEEDED', providerRefundId: 'refund-1', refundStatus: 'pending' },
    });
    await service.refundForCancelledOrder('order-1');
    expect(provider.fetchRefund).toHaveBeenCalledWith('refund-1');
    expect(provider.refund).not.toHaveBeenCalled();
  });
  it('leaves a canceled refund unresolved for operator attention', async () => {
    const { service, provider, prisma } = createService({ payment: { ...payment, status: 'SUCCEEDED' } });
    provider.refund.mockResolvedValue({ providerRefundId: 'refund-1', status: 'canceled', amount: 78_000 });
    expect(await service.refundForCancelledOrder('order-1')).toEqual({ refunded: false, amount: 0 });
    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { providerRefundId: 'refund-1', refundStatus: 'canceled' } }),
    );
  });
  it('does not reset a concurrently paid row when creating/reusing its payment', async () => {
    const { service, prisma } = createService();
    await service.startPayment('user-1', 'order-1');
    expect(prisma.payment.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
  });
});

describe('payment status monotonicity', () => {
  it('only changes cancellation status while the payment is pending', async () => {
    const { service, prisma } = createService({
      payment: { id: 'payment-1', orderId: 'order-1', amount: 78000, status: 'REFUNDED' },
      remote: { status: 'canceled', paid: false, amount: 78000 },
    });
    await service.handleNotification('yk-1');
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  });
});
