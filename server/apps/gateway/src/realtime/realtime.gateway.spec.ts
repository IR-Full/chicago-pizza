import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { of, throwError } from 'rxjs';
import type { Socket } from 'socket.io';
import { RealtimeGateway, WS_EVENTS } from './realtime.gateway';

const PAYLOAD = { sub: 'user-1', email: 'guest@chicago.ru', role: 'USER' };

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const TICKET_ID = '22222222-2222-4222-8222-222222222222';

interface GatewayOptions {
  verify?: jest.Mock;
  /** Whether the owning service answers the authorisation probe or refuses. */
  ownsResource?: boolean;
  revokedBefore?: number | null;
}

function createGateway({ verify, ownsResource = true, revokedBefore = null }: GatewayOptions = {}) {
  const verifyMock = verify ?? jest.fn(() => PAYLOAD);
  const jwt = { verify: verifyMock } as unknown as JwtService;
  const config = { get: jest.fn(() => 'access-secret') } as unknown as ConfigService;

  const cache = {
    get: jest.fn(async () => revokedBefore),
    client: { publish: jest.fn() },
  };

  const subscriber = { subscribe: jest.fn(async () => 1), on: jest.fn(), quit: jest.fn(async () => 'OK') };
  const redis = { duplicate: jest.fn(() => subscriber) };

  const answer = () =>
    ownsResource ? of({ id: 'resource' }) : throwError(() => ({ statusCode: 403, message: 'Нет доступа' }));
  const orders = { send: jest.fn(answer) };
  const support = { send: jest.fn(answer) };

  const gateway = new RealtimeGateway(
    jwt,
    config,
    cache as never,
    redis as never,
    orders as never,
    support as never,
  );

  // The chainable `.to().to().emit()` surface of a socket.io server.
  const emit = jest.fn();
  const rooms: string[] = [];
  const chain: any = { emit, to: jest.fn((room: string) => (rooms.push(room), chain)) };
  const disconnectSockets = jest.fn();
  gateway.server = { to: chain.to, in: jest.fn(() => ({ disconnectSockets })) } as never;

  return { gateway, verify: verifyMock, emit, rooms, config, cache, redis, subscriber, orders, support, disconnectSockets };
}

function socketOf(handshake: Record<string, any> = { auth: { token: 'tok' }, headers: {} }) {
  return {
    handshake: { headers: {}, ...handshake },
    data: {} as Record<string, unknown>,
    rooms: new Set<string>(),
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket & { join: jest.Mock; emit: jest.Mock; disconnect: jest.Mock };
}

describe('RealtimeGateway — connection handshake', () => {
  it('accepts the token from the socket auth field', async () => {
    const { gateway, verify } = createGateway();
    const client = socketOf();

    await gateway.handleConnection(client);

    expect(verify).toHaveBeenCalledWith('tok', { secret: 'access-secret' });
    expect(client.data.user).toEqual(PAYLOAD);
  });

  it('falls back to the httpOnly cookie the REST API sets', async () => {
    const { gateway, verify } = createGateway();
    const client = socketOf({ headers: { cookie: 'refresh_token=r; access_token=abc' } });

    await gateway.handleConnection(client);

    expect(verify).toHaveBeenCalledWith('abc', expect.anything());
  });

  it('joins a per-user room so broadcasts cannot leak across customers', async () => {
    const { gateway } = createGateway();
    const client = socketOf();

    await gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(client.join).not.toHaveBeenCalledWith('staff');
  });

  it.each([['ADMIN'], ['SUPPORT'], ['COURIER']])('puts %s into the staff room as well', async (role) => {
    const { gateway } = createGateway({ verify: jest.fn(() => ({ ...PAYLOAD, role })) });
    const client = socketOf();

    await gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith('staff');
  });

  it.each([
    ['no token at all', { headers: {} }],
    ['a cookie header without the access token', { headers: { cookie: 'refresh_token=r' } }],
  ])('disconnects a handshake with %s', async (_label, handshake) => {
    const { gateway } = createGateway();
    const client = socketOf(handshake);

    await gateway.handleConnection(client);

    expect(client.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized' });
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('disconnects a forged or expired token', async () => {
    const { gateway } = createGateway({
      verify: jest.fn(() => {
        throw new Error('jwt expired');
      }),
    });
    const client = socketOf();

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.data.user).toBeUndefined();
  });

  /**
   * A signature that still verifies is not enough: the account may have been
   * blocked since the token was minted.
   */
  it('refuses a token that was revoked before the socket opened', async () => {
    const { gateway } = createGateway({
      verify: jest.fn(() => ({ ...PAYLOAD, iat: Math.floor((Date.now() - 60_000) / 1000) })),
      revokedBefore: Date.now(),
    });
    const client = socketOf();

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('closes the socket when the access token it authenticated with expires', async () => {
    jest.useFakeTimers();
    try {
      const expiresInSeconds = 30;
      const { gateway } = createGateway({
        verify: jest.fn(() => ({ ...PAYLOAD, exp: Math.floor(Date.now() / 1000) + expiresInSeconds })),
      });
      const client = socketOf();

      await gateway.handleConnection(client);
      expect(client.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(expiresInSeconds * 1000);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('tolerates a disconnect from a socket that never authenticated', () => {
    const { gateway } = createGateway();

    expect(() => gateway.handleDisconnect(socketOf())).not.toThrow();
  });

  it('logs out a disconnecting authenticated socket without throwing', async () => {
    const { gateway } = createGateway();
    const client = socketOf();
    await gateway.handleConnection(client);

    expect(() => gateway.handleDisconnect(client)).not.toThrow();
  });
});

describe('RealtimeGateway — revocation fan-out', () => {
  it('subscribes to the revocation channel on a dedicated connection', async () => {
    const { gateway, redis, subscriber } = createGateway();

    await gateway.onModuleInit();

    // A subscribed ioredis client cannot run ordinary commands.
    expect(redis.duplicate).toHaveBeenCalled();
    expect(subscriber.subscribe).toHaveBeenCalledWith('auth:session-revoked');
  });

  it('drops every socket of a user whose sessions were revoked', async () => {
    const { gateway, subscriber, disconnectSockets } = createGateway();
    await gateway.onModuleInit();

    const [, handler] = subscriber.on.mock.calls[0] as [string, (channel: string, message: string) => void];
    handler('auth:session-revoked', 'user-9');

    expect(gateway.server.in).toHaveBeenCalledWith('user:user-9');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('closes the subscriber on shutdown', async () => {
    const { gateway, subscriber } = createGateway();
    await gateway.onModuleInit();

    await gateway.onModuleDestroy();

    expect(subscriber.quit).toHaveBeenCalled();
  });
});

/**
 * Joining a room *is* the authorisation decision — the room id is the
 * resource id. These used to join whatever id was asked for, so anyone who
 * learned an order or ticket id could follow a stranger's delivery or read
 * their conversation with support.
 */
describe('RealtimeGateway — client subscriptions', () => {
  it('joins an order room once the orders service confirms access', async () => {
    const { gateway, orders } = createGateway();
    const client = socketOf();
    await gateway.handleConnection(client);

    await expect(gateway.subscribeToOrder(client, { orderId: ORDER_ID })).resolves.toEqual({ ok: true });
    expect(orders.send).toHaveBeenCalledWith('orders.get_order', {
      userId: 'user-1',
      orderId: ORDER_ID,
      role: 'USER',
    });
    expect(client.join).toHaveBeenCalledWith(`order:${ORDER_ID}`);
  });

  it('joins a ticket room once the support service confirms access', async () => {
    const { gateway, support } = createGateway();
    const client = socketOf();
    await gateway.handleConnection(client);

    await expect(gateway.subscribeToTicket(client, { ticketId: TICKET_ID })).resolves.toEqual({ ok: true });
    expect(support.send).toHaveBeenCalledWith('support.get_ticket', {
      userId: 'user-1',
      role: 'USER',
      ticketId: TICKET_ID,
    });
    expect(client.join).toHaveBeenCalledWith(`ticket:${TICKET_ID}`);
  });

  it("refuses an order room the customer does not own", async () => {
    const { gateway } = createGateway({ ownsResource: false });
    const client = socketOf();
    await gateway.handleConnection(client);
    client.join.mockClear();

    await expect(gateway.subscribeToOrder(client, { orderId: ORDER_ID })).resolves.toEqual({ ok: false });
    expect(client.join).not.toHaveBeenCalled();
  });

  it("refuses a ticket thread the customer does not own", async () => {
    const { gateway } = createGateway({ ownsResource: false });
    const client = socketOf();
    await gateway.handleConnection(client);
    client.join.mockClear();

    await expect(gateway.subscribeToTicket(client, { ticketId: TICKET_ID })).resolves.toEqual({ ok: false });
    expect(client.join).not.toHaveBeenCalled();
  });

  it.each([
    ['an unauthenticated socket', false, { orderId: ORDER_ID }],
    ['a payload without an id', true, {} as { orderId: string }],
    ['an id that is not a uuid', true, { orderId: 'order-1' }],
  ])('refuses an order subscription from %s', async (_label, authenticated, data) => {
    const { gateway, orders } = createGateway();
    const client = socketOf();
    if (authenticated) await gateway.handleConnection(client);
    client.join.mockClear();
    orders.send.mockClear();

    await expect(gateway.subscribeToOrder(client, data)).resolves.toEqual({ ok: false });
    expect(client.join).not.toHaveBeenCalled();
    expect(orders.send).not.toHaveBeenCalled();
  });

  it.each([
    ['an unauthenticated socket', false, { ticketId: TICKET_ID }],
    ['a payload without an id', true, {} as { ticketId: string }],
    ['an id that is not a uuid', true, { ticketId: 't1' }],
  ])('refuses a ticket subscription from %s', async (_label, authenticated, data) => {
    const { gateway, support } = createGateway();
    const client = socketOf();
    if (authenticated) await gateway.handleConnection(client);
    client.join.mockClear();
    support.send.mockClear();

    await expect(gateway.subscribeToTicket(client, data)).resolves.toEqual({ ok: false });
    expect(client.join).not.toHaveBeenCalled();
    expect(support.send).not.toHaveBeenCalled();
  });

  it('stops a socket from hoarding rooms', async () => {
    const { gateway, orders } = createGateway();
    const client = socketOf();
    await gateway.handleConnection(client);

    // Pretend the socket already sits in the maximum number of rooms.
    for (let i = 0; i < 30; i++) (client.rooms as Set<string>).add(`order:${i}`);
    orders.send.mockClear();

    await expect(gateway.subscribeToOrder(client, { orderId: ORDER_ID })).resolves.toEqual({ ok: false });
    expect(orders.send).not.toHaveBeenCalled();
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

  it('nudges only the addressee when a notification is written', () => {
    const { gateway, emit, rooms } = createGateway();

    gateway.emitNotification('user-9');

    // Staff must not see someone else's bell light up.
    expect(rooms).toEqual(['user:user-9']);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.NOTIFICATION, { userId: 'user-9' });
  });

  it('names its events stably — the client listens on these strings', () => {
    expect(WS_EVENTS).toEqual({
      ORDER_STATUS: 'order:status',
      TICKET_MESSAGE: 'ticket:message',
      NOTIFICATION: 'notification',
    });
  });
});
