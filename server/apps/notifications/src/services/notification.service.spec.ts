import { NotificationService } from './notification.service';

/**
 * Email never blocks the domain action that triggered it: everything is
 * pushed onto a BullMQ queue with retries. These tests assert that contract
 * plus the in-app notification rows that the client polls.
 */
function createService() {
  const prisma: Record<string, any> = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1', email: 'guest@chicago.ru', firstName: 'Амина' })) },
    notification: {
      create: jest.fn(async () => ({ id: 'n1' })),
      findMany: jest.fn(async () => [{ id: 'n1' }]),
      count: jest.fn(async () => 1),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    pushSubscription: { upsert: jest.fn(async () => ({})) },
  };
  const config = { get: jest.fn(() => 'https://chicago-pizza.ru') };
  const queue = { add: jest.fn(async () => ({ id: 'job-1' })) };

  return { service: new NotificationService(prisma as never, config as never, queue as never), prisma, queue, config };
}

const enqueued = (queue: { add: jest.Mock }) => queue.add.mock.calls[0]?.[1];
const jobOptions = (queue: { add: jest.Mock }) => queue.add.mock.calls[0]?.[2];

describe('NotificationService — queueing', () => {
  it('enqueues rather than sending inline, with retries and backoff', async () => {
    const { service, queue } = createService();

    await service.handleEmailVerification({ email: 'guest@chicago.ru', firstName: 'Амина', code: '123456' });

    expect(queue.add).toHaveBeenCalledWith('send', expect.anything(), expect.anything());
    expect(jobOptions(queue)).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
    });
  });

  it('prunes completed and failed jobs so Redis does not grow forever', async () => {
    const { service, queue } = createService();

    await service.handleEmailVerification({ email: 'guest@chicago.ru', firstName: 'Амина', code: '123456' });

    expect(jobOptions(queue)).toMatchObject({ removeOnComplete: 1000, removeOnFail: 5000 });
  });
});

describe('NotificationService — verification email', () => {
  it('addresses the customer and carries the code', async () => {
    const { service, queue } = createService();

    await service.handleEmailVerification({ email: 'guest@chicago.ru', firstName: 'Амина', code: '424242' });

    expect(enqueued(queue)).toMatchObject({ to: 'guest@chicago.ru', subject: expect.stringContaining('код') });
    expect(enqueued(queue).html).toContain('424242');
    expect(enqueued(queue).html).toContain('Амина');
  });
});

describe('NotificationService — password reset email', () => {
  it('builds a reset link on the public client url', async () => {
    const { service, queue } = createService();

    await service.handlePasswordReset({ email: 'guest@chicago.ru', firstName: 'Амина', token: 'abc123' });

    expect(enqueued(queue).html).toContain('https://chicago-pizza.ru/reset-password?token=abc123');
  });

  it('url-encodes a token with reserved characters', async () => {
    const { service, queue } = createService();

    await service.handlePasswordReset({ email: 'guest@chicago.ru', firstName: 'Амина', token: 'a+b/c=d' });

    expect(enqueued(queue).html).toContain('token=a%2Bb%2Fc%3Dd');
  });
});

describe('NotificationService — order status', () => {
  it('stores an in-app notification and queues the email', async () => {
    const { service, prisma, queue } = createService();

    await service.handleOrderStatusChanged({ orderId: 'abcdef12-3456', userId: 'user-1', status: 'PREPARING' as never });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'ORDER_STATUS',
        title: 'Заказ №ABCDEF12',
        body: 'Ваша пицца готовится',
      },
    });
    expect(enqueued(queue).to).toBe('guest@chicago.ru');
  });

  it('links to the order on the client', async () => {
    const { service, queue } = createService();

    await service.handleOrderStatusChanged({ orderId: 'order-1', userId: 'user-1', status: 'DELIVERED' as never });

    expect(enqueued(queue).html).toContain('https://chicago-pizza.ru/orders/order-1');
  });

  it('does nothing for a user that no longer exists', async () => {
    const { service, prisma, queue } = createService();
    prisma.user.findUnique.mockResolvedValue(null);

    await service.handleOrderStatusChanged({ orderId: 'order-1', userId: 'ghost', status: 'CREATED' as never });

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('treats a new order as the CREATED status', async () => {
    const { service, prisma } = createService();

    await service.handleOrderCreated({ orderId: 'order-1', userId: 'user-1' });

    expect(prisma.notification.create.mock.calls[0][0].data.body).toBe('Заказ создан и ожидает подтверждения');
  });
});

describe('NotificationService — support replies', () => {
  it('notifies the recipient in-app and by email', async () => {
    const { service, prisma, queue } = createService();

    await service.handleTicketMessage({ ticketId: 't1', recipientId: 'user-1', subject: 'Холодная пицца' });

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'SUPPORT_REPLY',
        title: 'Новый ответ поддержки',
        body: 'По обращению «Холодная пицца» есть новое сообщение',
      },
    });
    expect(enqueued(queue).html).toContain('https://chicago-pizza.ru/support/t1');
  });

  it('stays silent for an unknown recipient', async () => {
    const { service, prisma, queue } = createService();
    prisma.user.findUnique.mockResolvedValue(null);

    await service.handleTicketMessage({ ticketId: 't1', recipientId: 'ghost', subject: 'Тема' });

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('NotificationService — query API', () => {
  it('lists the newest notifications with an unread count', async () => {
    const { service, prisma } = createService();
    prisma.notification.count.mockResolvedValueOnce(30).mockResolvedValueOnce(4);

    await expect(service.list('user-1')).resolves.toMatchObject({
      total: 30,
      unread: 4,
      page: 1,
      limit: 20,
      totalPages: 2,
    });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' }, orderBy: { createdAt: 'desc' }, skip: 0, take: 20 }),
    );
  });

  it('paginates', async () => {
    const { service, prisma } = createService();

    await service.list('user-1', 3, 5);

    expect(prisma.notification.findMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 5 });
  });

  it('marks one notification read', async () => {
    const { service, prisma } = createService();

    await expect(service.markRead('user-1', 'n1')).resolves.toEqual({ success: true });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: 'n1' },
      data: { isRead: true },
    });
  });

  it('marks everything read when no id is given', async () => {
    const { service, prisma } = createService();

    await service.markRead('user-1');

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isRead: false },
      data: { isRead: true },
    });
  });

  it('never marks another user’s notifications read', async () => {
    const { service, prisma } = createService();

    await service.markRead('user-1', 'n-of-someone-else');

    expect(prisma.notification.updateMany.mock.calls[0][0].where.userId).toBe('user-1');
  });
});

describe('NotificationService — push subscriptions', () => {
  it('upserts by endpoint so a re-subscribe does not duplicate', async () => {
    const { service, prisma } = createService();
    const keys = { p256dh: 'key', auth: 'auth' };

    await expect(service.subscribePush('user-1', 'https://push.example/1', keys)).resolves.toEqual({ success: true });
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/1' },
      update: { userId: 'user-1', keys },
      create: { userId: 'user-1', endpoint: 'https://push.example/1', keys },
    });
  });

  it('re-points an endpoint that changed hands', async () => {
    const { service, prisma } = createService();

    await service.subscribePush('user-2', 'https://push.example/1', {});

    expect(prisma.pushSubscription.upsert.mock.calls[0][0].update.userId).toBe('user-2');
  });
});
