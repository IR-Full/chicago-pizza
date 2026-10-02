import { RMQ_EVENTS } from '@chicago-pizza/common';
import { RealtimeEventsController } from './realtime-events.controller';
import { RealtimeGateway } from './realtime.gateway';

function createController() {
  const realtime = {
    emitOrderStatus: jest.fn(),
    emitTicketMessage: jest.fn(),
    emitNotification: jest.fn(),
  };

  return { controller: new RealtimeEventsController(realtime as unknown as RealtimeGateway), realtime };
}

const patternOf = (method: keyof RealtimeEventsController): string[] =>
  ([] as string[]).concat(
    Reflect.getMetadata('microservices:pattern', RealtimeEventsController.prototype[method]),
  );

describe('RealtimeEventsController — subscriptions', () => {
  it.each([
    ['onOrderCreated', RMQ_EVENTS.ORDER_CREATED],
    ['onOrderStatusChanged', RMQ_EVENTS.ORDER_STATUS_CHANGED],
    ['onTicketMessage', RMQ_EVENTS.TICKET_MESSAGE_CREATED],
  ])('%s listens on %s', (method, pattern) => {
    expect(patternOf(method as keyof RealtimeEventsController)).toContain(pattern);
  });
});

/**
 * These pushes used to live in the HTTP controllers, right after the RPC that
 * caused them. That made "the customer sees it move" a consequence of *which
 * endpoint was called* rather than of the change itself.
 */
describe('RealtimeEventsController — order events', () => {
  it('lights the bell for an order the customer just placed', () => {
    const { controller, realtime } = createController();

    controller.onOrderCreated({ orderId: 'order-1', userId: 'user-9' });

    // Checkout wrote a notification row and told nobody; the bell only
    // noticed on the next full page load.
    expect(realtime.emitNotification).toHaveBeenCalledWith('user-9');
  });

  it('pushes a status change to the customer and lights the bell', () => {
    const { controller, realtime } = createController();

    controller.onOrderStatusChanged({
      orderId: 'order-1',
      userId: 'user-9',
      status: 'ON_DELIVERY' as never,
      updatedAt: '2026-09-16T10:00:00.000Z',
    });

    expect(realtime.emitOrderStatus).toHaveBeenCalledWith('user-9', {
      orderId: 'order-1',
      status: 'ON_DELIVERY',
      updatedAt: '2026-09-16T10:00:00.000Z',
    });
    expect(realtime.emitNotification).toHaveBeenCalledWith('user-9');
  });
});

describe('RealtimeEventsController — ticket events', () => {
  it('broadcasts the message to the thread and nudges the addressee', () => {
    const { controller, realtime } = createController();

    controller.onTicketMessage({
      ticketId: 't1',
      ticketOwnerId: 'user-9',
      message: { id: 'm1', message: 'Разобрались' },
      notifyUserId: 'user-9',
    });

    expect(realtime.emitTicketMessage).toHaveBeenCalledWith('t1', 'user-9', {
      id: 'm1',
      message: 'Разобрались',
    });
    expect(realtime.emitNotification).toHaveBeenCalledWith('user-9');
  });

  it('broadcasts without a nudge when the author is the one who would get it', () => {
    const { controller, realtime } = createController();

    // A customer writing into their own ticket: staff see it live, but
    // nudging the author about their own message is a pointless refetch.
    controller.onTicketMessage({
      ticketId: 't1',
      ticketOwnerId: 'user-9',
      message: { id: 'm1' },
      notifyUserId: null,
    });

    expect(realtime.emitTicketMessage).toHaveBeenCalled();
    expect(realtime.emitNotification).not.toHaveBeenCalled();
  });
});
