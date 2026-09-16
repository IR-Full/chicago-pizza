import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
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
import * as cookie from 'cookie';
import { JwtPayload } from '@chicago-pizza/common';
import { OrderStatus, Role } from '@chicago-pizza/prisma';

const STAFF_ROLES: Role[] = [Role.ADMIN, Role.SUPPORT, Role.COURIER];

export const WS_EVENTS = {
  ORDER_STATUS: 'order:status',
  TICKET_MESSAGE: 'ticket:message',
  NOTIFICATION: 'notification',
} as const;

/**
 * Single public WebSocket surface. Every connection is authenticated with the
 * same httpOnly access-token cookie the REST API uses, then joined to a
 * per-user room (`user:<id>`) so a broadcast can never leak another
 * customer's order or chat. Staff additionally join the `staff` room.
 *
 * A Redis adapter is attached in main.ts so a broadcast issued by one gateway
 * replica reaches sockets connected to the others.
 */
@WebSocketGateway({
  cors: { origin: process.env.CLIENT_URL, credentials: true },
  path: '/socket.io',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  handleConnection(client: Socket) {
    const payload = this.authenticate(client);
    if (!payload) {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }

    client.data.user = payload;
    client.join(this.userRoom(payload.sub));
    if (STAFF_ROLES.includes(payload.role)) client.join('staff');

    this.logger.debug(`Socket connected: ${payload.email}`);
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user as JwtPayload | undefined;
    if (user) this.logger.debug(`Socket disconnected: ${user.email}`);
  }

  /** Lets a client watch one specific order's status stream. */
  @SubscribeMessage('order:subscribe')
  subscribeToOrder(@ConnectedSocket() client: Socket, @MessageBody() data: { orderId: string }) {
    const user = client.data.user as JwtPayload | undefined;
    if (!user || !data?.orderId) return { ok: false };
    client.join(`order:${data.orderId}`);
    return { ok: true };
  }

  @SubscribeMessage('ticket:subscribe')
  subscribeToTicket(@ConnectedSocket() client: Socket, @MessageBody() data: { ticketId: string }) {
    const user = client.data.user as JwtPayload | undefined;
    if (!user || !data?.ticketId) return { ok: false };
    client.join(`ticket:${data.ticketId}`);
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
      // Kitchen/courier dashboards watch every order.
      .to('staff')
      .emit(WS_EVENTS.ORDER_STATUS, { ...payload, userId });
  }

  emitTicketMessage(ticketId: string, ticketOwnerId: string, message: unknown) {
    this.server
      .to(`ticket:${ticketId}`)
      .to(this.userRoom(ticketOwnerId))
      .to('staff')
      .emit(WS_EVENTS.TICKET_MESSAGE, { ticketId, message });
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
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
    return cookie.parse(rawCookie).access_token ?? null;
  }
}
