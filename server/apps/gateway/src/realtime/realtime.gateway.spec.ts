import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { RealtimeGateway, WS_EVENTS } from './realtime.gateway';

/* eslint-disable @typescript-eslint/no-explicit-any -- socket.io mocks */

const PAYLOAD = { sub: 'user-1', email: 'guest@chicago.ru', role: 'USER' };

function createGateway(verify: jest.Mock = jest.fn(() => PAYLOAD)) {
  const jwt = { verify } as unknown as JwtService;
  const config = { get: jest.fn(() => 'access-secret') } as unknown as ConfigService;
  const gateway = new RealtimeGateway(jwt, config);

  // The chainable `.to().to().emit()` surface of a socket.io server.
  const emit = jest.fn();
  const rooms: string[] = [];
  const chain: any = { emit, to: jest.fn((room: string) => (rooms.push(room), chain)) };
  gateway.server = { to: chain.to } as never;

  return { gateway, verify, emit, rooms, config };
}

function socketOf(handshake: Record<string, any> = { auth: { token: 'tok' }, headers: {} }) {
  return {
    handshake: { headers: {}, ...handshake },
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket & { join: jest.Mock; emit: jest.Mock; disconnect: jest.Mock };
}

describe('RealtimeGateway — connection handshake', () => {
  it('accepts the token from the socket auth field', () => {
    const { gateway, verify } = createGateway();
    const client = socketOf();

    gateway.handleConnection(client);

    expect(verify).toHaveBeenCalledWith('tok', { secret: 'access-secret' });
    expect(client.data.user).toEqual(PAYLOAD);
  });

  it('falls back to the httpOnly cookie the REST API sets', () => {
    const { gateway, verify } = createGateway();
    const client = socketOf({ headers: { cookie: 'refresh_token=r; access_token=abc' } });

    gateway.handleConnection(client);

    expect(verify).toHaveBeenCalledWith('abc', expect.anything());
  });

  it('joins a per-user room so broadcasts cannot leak across customers', () => {
    const { gateway } = createGateway();
    const client = socketOf();

    gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(client.join).not.toHaveBeenCalledWith('staff');
  });

  it.each([['ADMIN'], ['SUPPORT'], ['COURIER']])('puts %s into the staff room as well', (role) => {
    const { gateway } = createGateway(jest.fn(() => ({ ...PAYLOAD, role })));
    const client = socketOf();

    gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith('staff');
  });

  it.each([
    ['no token at all', { headers: {} }],
    ['a cookie header without the access token', { headers: { cookie: 'refresh_token=r' } }],
  ])('disconnects a handshake with %s', (_label, handshake) => {
    const { gateway } = createGateway();
    const client = socketOf(handshake);

    gateway.handleConnection(client);

    expect(client.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized' });
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('disconnects a forged or expired token', () => {
    const { gateway } = createGateway(
      jest.fn(() => {
        throw new Error('jwt expired');
      }),
    );
    const client = socketOf();

    gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.data.user).toBeUndefined();
  });

  it('tolerates a disconnect from a socket that never authenticated', () => {
    const { gateway } = createGateway();

    expect(() => gateway.handleDisconnect(socketOf())).not.toThrow();
  });

  it('logs out a disconnecting authenticated socket without throwing', () => {
    const { gateway } = createGateway();
    const client = socketOf();
    gateway.handleConnection(client);

    expect(() => gateway.handleDisconnect(client)).not.toThrow();
  });
});

describe('RealtimeGateway — client subscriptions', () => {
  it('joins an order room on request', () => {
    const { gateway } = createGateway();
    const client = socketOf();
    gateway.handleConnection(client);

    expect(gateway.subscribeToOrder(client, { orderId: 'order-1' })).toEqual({ ok: true });
    expect(client.join).toHaveBeenCalledWith('order:order-1');
  });

  it('joins a ticket room on request', () => {
    const { gateway } = createGateway();
    const client = socketOf();
    gateway.handleConnection(client);

    expect(gateway.subscribeToTicket(client, { ticketId: 't1' })).toEqual({ ok: true });
    expect(client.join).toHaveBeenCalledWith('ticket:t1');
  });

  it.each([
    ['an unauthenticated socket', false, { orderId: 'order-1' }],
    ['a payload without an id', true, {} as { orderId: string }],
  ])('refuses an order subscription from %s', (_label, authenticated, data) => {
    const { gateway } = createGateway();
    const client = socketOf();
    if (authenticated) gateway.handleConnection(client);
    client.join.mockClear();

    expect(gateway.subscribeToOrder(client, data)).toEqual({ ok: false });
    expect(client.join).not.toHaveBeenCalled();
  });

  it.each([
    ['an unauthenticated socket', false, { ticketId: 't1' }],
    ['a payload without an id', true, {} as { ticketId: string }],
  ])('refuses a ticket subscription from %s', (_label, authenticated, data) => {
    const { gateway } = createGateway();
    const client = socketOf();
    if (authenticated) gateway.handleConnection(client);
    client.join.mockClear();

    expect(gateway.subscribeToTicket(client, data)).toEqual({ ok: false });
    expect(client.join).not.toHaveBeenCalled();
  });
});

describe('RealtimeGateway — broadcasts', () => {
  it('sends an order update to the customer, the order room and staff once', () => {
    const { gateway, emit, rooms } = createGateway();

    gateway.emitOrderStatus('user-9', {
      orderId: 'order-1',
      status: 'ON_DELIVERY' as never,
      updatedAt: '2026-09-16T10:00:00.000Z',
    });

    // Chained `.to()` targets the union of the rooms, so a customer who is in
    // two of them still receives exactly one event.
    expect(rooms).toEqual(['user:user-9', 'order:order-1', 'staff']);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.ORDER_STATUS, {
      orderId: 'order-1',
      status: 'ON_DELIVERY',
      updatedAt: '2026-09-16T10:00:00.000Z',
      userId: 'user-9',
    });
  });

  it('sends a ticket message to the thread, its owner and staff once', () => {
    const { gateway, emit, rooms } = createGateway();

    gateway.emitTicketMessage('t1', 'user-9', { id: 'm1', message: 'Ответ' });

    expect(rooms).toEqual(['ticket:t1', 'user:user-9', 'staff']);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.TICKET_MESSAGE, {
      ticketId: 't1',
      message: { id: 'm1', message: 'Ответ' },
    });
  });

  it('names its events stably — the client listens on these strings', () => {
    expect(WS_EVENTS).toEqual({
      ORDER_STATUS: 'order:status',
      TICKET_MESSAGE: 'ticket:message',
      NOTIFICATION: 'notification',
    });
  });
});
