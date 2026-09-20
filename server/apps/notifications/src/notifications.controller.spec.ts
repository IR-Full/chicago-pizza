import { NOTIFICATIONS_PATTERNS, RMQ_EVENTS } from '@chicago-pizza/common';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './services/notification.service';

function createController() {
  const notifications: Record<string, any> = {
    handleEmailVerification: jest.fn(async () => undefined),
    handlePasswordReset: jest.fn(async () => undefined),
    handleOrderCreated: jest.fn(async () => undefined),
    handleOrderStatusChanged: jest.fn(async () => undefined),
    handleTicketMessage: jest.fn(async () => undefined),
    list: jest.fn(async () => ({ items: [] })),
    markRead: jest.fn(async () => ({ success: true })),
    subscribePush: jest.fn(async () => ({ success: true })),
  };

  return {
    controller: new NotificationsController(notifications as unknown as NotificationService),
    notifications,
  };
}

const metaOf = (key: string, method: keyof NotificationsController): string[] =>
  ([] as string[]).concat(Reflect.getMetadata(key, NotificationsController.prototype[method]) ?? []);

describe('NotificationsController — routing', () => {
  it.each([
    ['onEmailVerification', RMQ_EVENTS.EMAIL_VERIFICATION_REQUESTED],
    ['onPasswordReset', RMQ_EVENTS.PASSWORD_RESET_REQUESTED],
    ['onOrderCreated', RMQ_EVENTS.ORDER_CREATED],
    ['onOrderStatusChanged', RMQ_EVENTS.ORDER_STATUS_CHANGED],
    ['onTicketMessage', RMQ_EVENTS.TICKET_MESSAGE_CREATED],
    ['onUserRegistered', RMQ_EVENTS.USER_REGISTERED],
  ])('%s subscribes to the %s event', (method, event) => {
    expect(metaOf('microservices:pattern', method as keyof NotificationsController)).toContain(event);
  });

  it.each([
    ['list', NOTIFICATIONS_PATTERNS.LIST_NOTIFICATIONS],
    ['markRead', NOTIFICATIONS_PATTERNS.MARK_READ],
    ['subscribePush', NOTIFICATIONS_PATTERNS.SUBSCRIBE_PUSH],
  ])('%s answers the %s request', (method, pattern) => {
    expect(metaOf('microservices:pattern', method as keyof NotificationsController)).toContain(pattern);
  });

  it('marks the domain handlers as events, not requests', () => {
    // Handler type 2 is @EventPattern, 1 is @MessagePattern. An event handler
    // must not try to reply — the emitter is not waiting for one.
    const handlerType = (method: keyof NotificationsController) =>
      Reflect.getMetadata('microservices:handler_type', NotificationsController.prototype[method]);

    expect(handlerType('onOrderCreated')).toBe(2);
    expect(handlerType('onTicketMessage')).toBe(2);
    expect(handlerType('list')).toBe(1);
    expect(handlerType('markRead')).toBe(1);
  });
});

describe('NotificationsController — delegation', () => {
  it('forwards each event payload unchanged', async () => {
    const { controller, notifications } = createController();

    await controller.onEmailVerification({ email: 'a@b.ru', firstName: 'Амина', code: '1' });
    await controller.onPasswordReset({ email: 'a@b.ru', firstName: 'Амина', token: 't' });
    await controller.onOrderCreated({ orderId: 'o1', userId: 'u1' });
    await controller.onOrderStatusChanged({ orderId: 'o1', userId: 'u1', status: 'PREPARING' as never });
    await controller.onTicketMessage({ ticketId: 't1', recipientId: 'u1', subject: 'Тема' });

    expect(notifications.handleEmailVerification).toHaveBeenCalledWith({ email: 'a@b.ru', firstName: 'Амина', code: '1' });
    expect(notifications.handlePasswordReset).toHaveBeenCalledWith({ email: 'a@b.ru', firstName: 'Амина', token: 't' });
    expect(notifications.handleOrderCreated).toHaveBeenCalledWith({ orderId: 'o1', userId: 'u1' });
    expect(notifications.handleOrderStatusChanged).toHaveBeenCalledWith({
      orderId: 'o1',
      userId: 'u1',
      status: 'PREPARING',
    });
    expect(notifications.handleTicketMessage).toHaveBeenCalledWith({ ticketId: 't1', recipientId: 'u1', subject: 'Тема' });
  });

  it('consumes the registration event without side effects', () => {
    const { controller, notifications } = createController();

    expect(controller.onUserRegistered({ userId: 'user-1', email: 'a@b.ru' })).toBeUndefined();
    expect(Object.values(notifications).every((mock) => (mock as jest.Mock).mock.calls.length === 0)).toBe(true);
  });

  it('passes pagination through, including when absent', async () => {
    const { controller, notifications } = createController();

    await controller.list({ userId: 'u1', page: 2, limit: 5 });
    await controller.list({ userId: 'u1' });

    expect(notifications.list).toHaveBeenNthCalledWith(1, 'u1', 2, 5);
    expect(notifications.list).toHaveBeenNthCalledWith(2, 'u1', undefined, undefined);
  });

  it('marks one or all notifications read', async () => {
    const { controller, notifications } = createController();

    await controller.markRead({ userId: 'u1', notificationId: 'n1' });
    await controller.markRead({ userId: 'u1' });

    expect(notifications.markRead).toHaveBeenNthCalledWith(1, 'u1', 'n1');
    expect(notifications.markRead).toHaveBeenNthCalledWith(2, 'u1', undefined);
  });

  it('splits the push subscription payload', async () => {
    const { controller, notifications } = createController();
    const keys = { p256dh: 'k', auth: 'a' };

    await controller.subscribePush({ userId: 'u1', endpoint: 'https://push/1', keys });

    expect(notifications.subscribePush).toHaveBeenCalledWith('u1', 'https://push/1', keys);
  });
});
