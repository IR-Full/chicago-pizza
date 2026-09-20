import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
import { IS_PUBLIC_KEY, NOTIFICATIONS_PATTERNS, PaginationDto, SUPPORT_PATTERNS } from '@chicago-pizza/common';
import { SupportController } from './support.controller';
import { RealtimeGateway } from '../realtime/realtime.gateway';

function createController(supportReply: unknown = { message: { id: 'm1' }, ticketOwnerId: 'user-1' }) {
  const supportSend = jest.fn(() => of(supportReply));
  const notificationsSend = jest.fn(() => of({ ok: true }));
  const realtime = {
    emitTicketMessage: jest.fn(),
    emitNotification: jest.fn(),
  } as unknown as RealtimeGateway;

  return {
    controller: new SupportController(
      { send: supportSend } as unknown as ClientProxy,
      { send: notificationsSend } as unknown as ClientProxy,
      realtime,
    ),
    supportSend,
    notificationsSend,
    realtime,
  };
}

const meta = (key: string, method: keyof SupportController) =>
  Reflect.getMetadata(key, SupportController.prototype[method]);

const USER = { sub: 'user-1', email: 'a@b.ru', role: 'USER' } as never;

describe('gateway SupportController — HTTP surface', () => {
  it.each([
    ['createTicket', 'support/tickets', 1],
    ['listTickets', 'support/tickets', 0],
    ['getTicket', 'support/tickets/:id', 0],
    ['addMessage', 'support/tickets/:id/messages', 1],
    ['closeTicket', 'support/tickets/:id/close', 4],
    ['listNotifications', 'notifications', 0],
    ['markRead', 'notifications/read', 4],
    ['subscribePush', 'notifications/push-subscription', 1],
  ])('%s handles %s', (method, path, httpMethod) => {
    expect(meta('path', method as keyof SupportController)).toBe(path);
    expect(meta('method', method as keyof SupportController)).toBe(httpMethod);
  });

  it('keeps every route behind authentication', () => {
    for (const method of ['createTicket', 'getTicket', 'addMessage', 'listNotifications'] as const) {
      expect(meta(IS_PUBLIC_KEY, method)).toBeUndefined();
    }
  });
});

describe('gateway SupportController — tickets', () => {
  it('creates a ticket under the caller', async () => {
    const { controller, supportSend } = createController({ id: 't1' });

    await controller.createTicket(USER, { subject: 'Холодная пицца', message: 'Привезли холодной' } as never);

    expect(supportSend).toHaveBeenCalledWith(SUPPORT_PATTERNS.CREATE_TICKET, {
      userId: 'user-1',
      subject: 'Холодная пицца',
      message: 'Привезли холодной',
    });
  });

  it('lists the caller’s tickets', async () => {
    const { controller, supportSend } = createController([]);

    await controller.listTickets(USER);

    expect(supportSend).toHaveBeenCalledWith(SUPPORT_PATTERNS.LIST_TICKETS, { userId: 'user-1' });
  });

  it('sends the role along so staff can open any ticket', async () => {
    const { controller, supportSend } = createController({ id: 't1' });

    await controller.getTicket({ sub: 'staff-1', role: 'SUPPORT' } as never, 't1');

    expect(supportSend).toHaveBeenCalledWith(SUPPORT_PATTERNS.GET_TICKET, {
      userId: 'staff-1',
      role: 'SUPPORT',
      ticketId: 't1',
    });
  });

  it('pushes a new message over the socket and returns just the message', async () => {
    const { controller, supportSend, realtime } = createController();

    const result = await controller.addMessage(USER, 't1', { message: 'Привет' } as never);

    expect(supportSend).toHaveBeenCalledWith(SUPPORT_PATTERNS.ADD_MESSAGE, {
      userId: 'user-1',
      role: 'USER',
      ticketId: 't1',
      message: 'Привет',
    });
    expect(realtime.emitTicketMessage).toHaveBeenCalledWith('t1', 'user-1', { id: 'm1' });
    expect(result).toEqual({ id: 'm1' });
  });

  it('does not ping the author about their own message', async () => {
    const { controller, realtime } = createController();

    // USER is the ticket owner here, so there is no notification to announce.
    await controller.addMessage(USER, 't1', { message: 'Привет' } as never);

    expect(realtime.emitNotification).not.toHaveBeenCalled();
  });

  it('pings the customer when support replies', async () => {
    const { controller, realtime } = createController({
      message: { id: 'm2' },
      ticketOwnerId: 'user-9',
    });

    await controller.addMessage({ sub: 'support-1', role: 'SUPPORT' } as never, 't1', {
      message: 'Разобрались',
    } as never);

    expect(realtime.emitNotification).toHaveBeenCalledWith('user-9');
  });

  it('closes a ticket with the caller role attached', async () => {
    const { controller, supportSend } = createController({ id: 't1', status: 'CLOSED' });

    await controller.closeTicket(USER, 't1');

    expect(supportSend).toHaveBeenCalledWith(SUPPORT_PATTERNS.CLOSE_TICKET, {
      userId: 'user-1',
      role: 'USER',
      ticketId: 't1',
    });
  });
});

describe('gateway SupportController — notifications', () => {
  it('defaults to the first page of twenty', async () => {
    const { controller, notificationsSend } = createController();

    await controller.listNotifications(USER, new PaginationDto());

    expect(notificationsSend).toHaveBeenCalledWith(NOTIFICATIONS_PATTERNS.LIST_NOTIFICATIONS, {
      userId: 'user-1',
      page: 1,
      limit: 20,
    });
  });

  it('converts the pagination query strings', async () => {
    const { controller, notificationsSend } = createController();

    await controller.listNotifications(USER, Object.assign(new PaginationDto(), { page: 2, limit: 5 }));

    expect(notificationsSend).toHaveBeenCalledWith(NOTIFICATIONS_PATTERNS.LIST_NOTIFICATIONS, {
      userId: 'user-1',
      page: 2,
      limit: 5,
    });
  });

  it('marks one or all notifications read', async () => {
    const { controller, notificationsSend } = createController();

    await controller.markRead(USER, 'n1');
    await controller.markRead(USER);

    expect(notificationsSend).toHaveBeenNthCalledWith(1, NOTIFICATIONS_PATTERNS.MARK_READ, {
      userId: 'user-1',
      notificationId: 'n1',
    });
    expect(notificationsSend).toHaveBeenNthCalledWith(2, NOTIFICATIONS_PATTERNS.MARK_READ, {
      userId: 'user-1',
      notificationId: undefined,
    });
  });

  it('stores a push subscription against the caller', async () => {
    const { controller, notificationsSend } = createController();
    const keys = { p256dh: 'k', auth: 'a' };

    await controller.subscribePush(USER, { endpoint: 'https://push/1', keys } as never);

    expect(notificationsSend).toHaveBeenCalledWith(NOTIFICATIONS_PATTERNS.SUBSCRIBE_PUSH, {
      userId: 'user-1',
      endpoint: 'https://push/1',
      keys,
    });
  });
});
