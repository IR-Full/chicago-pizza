import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { isUUID } from 'class-validator';
import {
  isSessionRevoked,
  JwtPayload,
  ORDERS_PATTERNS,
  REDIS_CLIENT,
  RedisCacheService,
  rpcSend,
  SESSION_REVOKED_CHANNEL,
  shortId,
  SUPPORT_PATTERNS,
} from '@chicago-pizza/common';
import { OrderStatus, Role } from '@chicago-pizza/prisma';

/** The kitchen/courier board: every order that moves, without who ordered it. */
export const ORDER_BOARD_ROOM = 'staff:orders';

/** The support queue: the text of what customers write in. */
export const SUPPORT_BOARD_ROOM = 'staff:support';

/**
 * Which broadcast feeds each staff role is entitled to.
 *
 * There used to be one `staff` room holding all three roles, which meant a
 * courier received the full text of every support conversation in real time —
 * while the REST API (`SupportService`, where staff is admin + support only)
 * refused them the same data. Closing the IDOR on `ticket:subscribe` shut the
 * door a courier had to knock on; this room delivered the same thing unasked.
 * A role's rooms have to match the roles' REST permissions, or the socket
 * quietly becomes the more generous of the two interfaces.
 */
const STAFF_ROOMS: Partial<Record<Role, readonly string[]>> = {
  [Role.ADMIN]: [ORDER_BOARD_ROOM, SUPPORT_BOARD_ROOM],
  [Role.COURIER]: [ORDER_BOARD_ROOM],
  [Role.SUPPORT]: [SUPPORT_BOARD_ROOM],
};

/** One tab watching a handful of orders is normal; hundreds of rooms is not. */
const MAX_ROOMS_PER_SOCKET = 30;

/**
 * Reads one cookie out of a raw `Cookie` header.
 *
 * `cookie-parser` handles this for HTTP, but a WebSocket handshake is decided
 * before any Express middleware runs, so the header arrives raw. Six lines
 * beat carrying a dependency whose only remaining caller was this function.
 */
function readCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

export const WS_EVENTS = {
  ORDER_STATUS: 'order:status',
  TICKET_MESSAGE: 'ticket:message',
  NOTIFICATION: 'notification',
} as const;

/**
 * Single public WebSocket surface. Every connection is authenticated with the
 * same httpOnly access-token cookie the REST API uses, then joined to a
 * per-user room (`user:<id>`) so a broadcast can never leak another
 * customer's order or chat. Staff additionally join the board rooms their
 * role is entitled to — see `STAFF_ROOMS`.
 *
 * A Redis adapter is attached in main.ts so a broadcast issued by one gateway
 * replica reaches sockets connected to the others.
 */
@WebSocketGateway({
  cors: { origin: process.env.CLIENT_URL, credentials: true },
  path: '/socket.io',
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private revocationSubscriber: Redis | null = null;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly cache: RedisCacheService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject('ORDERS_SERVICE') private readonly orders: ClientProxy,
    @Inject('SUPPORT_SERVICE') private readonly support: ClientProxy,
  ) {}

  /**
   * A connection authenticates once and then lives for hours, so blocking a
   * customer or demoting an admin has to reach the socket too — the REST
   * guards re-read the revocation stamp on every request, a socket never
   * would. Auth publishes the user id here; every gateway replica drops that
   * user's connections immediately.
   */
  async onModuleInit(): Promise<void> {
    // A subscribed ioredis connection cannot run normal commands, so the
    // shared client is duplicated rather than borrowed.
    this.revocationSubscriber = this.redis.duplicate();
    await this.revocationSubscriber.subscribe(SESSION_REVOKED_CHANNEL);
    this.revocationSubscriber.on('message', (_channel, userId) => {
      this.server?.in(this.userRoom(userId)).disconnectSockets(true);
      this.logger.debug(`Dropped sockets of revoked user ${shortId(userId)}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.revocationSubscriber?.quit();
  }

  async handleConnection(client: Socket) {
    const payload = this.authenticate(client);
    if (!payload || (await isSessionRevoked(this.cache, payload))) {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }

    client.data.user = payload;
    // `join` returns a promise once an adapter is attached — the Redis one
    // is. Dropping it meant a failed join left the socket connected but in no
    // room, silently receiving nothing, with the error going nowhere.
    await client.join(this.userRoom(payload.sub));
    for (const room of STAFF_ROOMS[payload.role] ?? []) await client.join(room);

    // The token this socket authenticated with expires; the connection
    // should not outlive it. The client reconnects with a refreshed cookie.
    if (payload.exp) {
      const msLeft = payload.exp * 1000 - Date.now();
      if (msLeft > 0) {
        const timer = setTimeout(() => client.disconnect(true), msLeft);
        // Never hold the process open during a deploy.
        timer.unref?.();
        client.data.expiryTimer = timer;
      }
    }

    this.logger.debug(`Socket connected: ${shortId(payload.sub)}`);
  }

  handleDisconnect(client: Socket) {
    const timer = client.data.expiryTimer as NodeJS.Timeout | undefined;
    if (timer) clearTimeout(timer);

    const user = client.data.user as JwtPayload | undefined;
    if (user) this.logger.debug(`Socket disconnected: ${shortId(user.sub)}`);
  }

  /**
   * Lets a client watch one specific order's status stream.
   *
   * Joining is an authorisation decision, not a subscription preference: the
   * room id *is* the resource id. Without this check any signed-in visitor
   * who learned an order id — from a screenshot, a shared link, a log — could
   * join and follow a stranger's delivery. The REST guard for the same
   * resource is reused rather than reimplemented.
   */
  @SubscribeMessage('order:subscribe')
  async subscribeToOrder(@ConnectedSocket() client: Socket, @MessageBody() data: { orderId: string }) {
    const user = this.activeUser(client);
    if (!user || !isUUID(data?.orderId) || !this.canJoinMore(client)) return { ok: false };

    try {
      await rpcSend(this.orders, ORDERS_PATTERNS.GET_ORDER, {
        userId: user.sub,
        orderId: data.orderId,
        role: user.role,
      });
    } catch {
      return { ok: false };
    }

    await client.join(`order:${data.orderId}`);
    return { ok: true };
  }

  @SubscribeMessage('ticket:subscribe')
  async subscribeToTicket(@ConnectedSocket() client: Socket, @MessageBody() data: { ticketId: string }) {
    const user = this.activeUser(client);
    if (!user || !isUUID(data?.ticketId) || !this.canJoinMore(client)) return { ok: false };

    try {
      await rpcSend(this.support, SUPPORT_PATTERNS.GET_TICKET, {
        userId: user.sub,
        role: user.role,
        ticketId: data.ticketId,
      });
    } catch {
      return { ok: false };
    }

    await client.join(`ticket:${data.ticketId}`);
    return { ok: true };
  }

  // ── Server-side broadcast API, called from controllers ───────

  /**
   * Chained `.to()` calls target the *union* of the rooms and deliver once
   * per socket. Separate `.emit()` calls would double-fire for a client that
   * is in more than one of them — e.g. the customer watching their own order
   * is in both `user:<id>` and `order:<id>`.
   */
  emitOrderStatus(userId: string, payload: { orderId: string; status: OrderStatus; updatedAt: string }) {
    this.server
      .to(this.userRoom(userId))
      .to(`order:${payload.orderId}`)
      // Kitchen and couriers watch every order that moves. The customer's id
      // is deliberately not in the payload: the board refetches its own
      // (role-scoped) list from the API, so the only thing it needs from the
      // socket is that something changed — and a broadcast to a room is the
      // one place where "who" cannot be filtered per recipient.
      .to(ORDER_BOARD_ROOM)
      .emit(WS_EVENTS.ORDER_STATUS, payload);
  }

  emitTicketMessage(ticketId: string, ticketOwnerId: string, message: unknown) {
    this.server
      .to(`ticket:${ticketId}`)
      .to(this.userRoom(ticketOwnerId))
      .to(SUPPORT_BOARD_ROOM)
      .emit(WS_EVENTS.TICKET_MESSAGE, { ticketId, message });
  }

  /**
   * A nudge for the notification bell. The notifications service has already
   * written the row; the payload stays minimal on purpose so the client
   * refetches the authoritative list instead of trusting a pushed copy.
   */
  emitNotification(userId: string) {
    this.server.to(this.userRoom(userId)).emit(WS_EVENTS.NOTIFICATION, { userId });
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private activeUser(client: Socket): JwtPayload | undefined {
    return client.data.user as JwtPayload | undefined;
  }

  /** Every socket is in its own id room plus `user:<id>`, hence the offset. */
  private canJoinMore(client: Socket): boolean {
    return client.rooms.size < MAX_ROOMS_PER_SOCKET;
  }

  private authenticate(client: Socket): JwtPayload | null {
    const token = this.extractToken(client);
    if (!token) return null;
    try {
      return this.jwt.verify<JwtPayload>(token, { secret: this.config.get<string>('JWT_ACCESS_SECRET') });
    } catch {
      return null;
    }
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token as string | undefined;
    if (authToken) return authToken;

    const rawCookie = client.handshake.headers.cookie;
    if (!rawCookie) return null;
    return readCookie(rawCookie, 'access_token');
  }
}
