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
  enabled?: boolean;
}

function createService(fixture: Fixture = {}) {
  const prisma = {
    order: {
      findFirst: jest.fn(async () => (fixture.order === undefined ? ORDER : fixture.order)),
      findUniqueOrThrow: jest.fn(async () => (fixture.order === undefined ? ORDER : fixture.order)),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    orderStatusHistory: { create: jest.fn(async () => ({})) },
    payment: {
      findUnique: jest.fn(async () => fixture.payment ?? null),
      upsert: jest.fn(async () => ({ id: 'payment-1' })),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: fixture.paidCount ?? 1 })),
    },
  };

  const provider = {
    isEnabled: fixture.enabled ?? true,
    create: jest.fn(async () => ({
      providerPaymentId: 'yk-1',
      confirmationUrl: 'https://pay.example/yk-1',
    })),
    fetch: jest.fn(async () => ({
      providerPaymentId: 'yk-1',
      status: fixture.remote?.status ?? 'succeeded',
      paid: fixture.remote?.paid ?? true,
      amount: fixture.remote?.amount ?? 78_000,
    })),
  };

  const config = { get: jest.fn(() => 'https://chicago-pizza.ru') };
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

    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACCEPTED' } }),
    );
  });

  it('announces the change on both buses', async () => {
    const { service, notifications, realtime } = createService({ payment: pending });

    await service.handleNotification('yk-1');

    for (const bus of [notifications, realtime]) {
      expect(bus.emit).toHaveBeenCalledWith(
        'order.status.changed',
        expect.objectContaining({ orderId: 'order-1', status: 'ACCEPTED' }),
      );
    }
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

    expect(prisma.payment.update).toHaveBeenCalledWith(
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

    expect(prisma.payment.update).toHaveBeenCalledWith(
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
