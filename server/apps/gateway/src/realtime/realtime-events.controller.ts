import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { RMQ_EVENTS } from '@chicago-pizza/common';
import { OrderStatus } from '@chicago-pizza/prisma';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Turns domain events into WebSocket pushes.
 *
 * These pushes used to be fired by the HTTP controllers, immediately after
 * the RPC that caused them returned — which tied "the customer sees it move"
 * to "a member of staff clicked a button in our admin panel". Two things
 * followed. A placed order wrote its notification row but nudged nobody, so
 * the bell stayed stale until a reload. And any status change that did not
 * come through that one endpoint — a scheduled job, a till integration, a
 * back-office script — pushed nothing at all, silently.
 *
 * The event is the fact; the push is a consequence of the fact, not of the
 * request that produced it. So the gateway subscribes like any other
 * consumer, and every producer gets live updates for free.
 */
@Controller()
export class RealtimeEventsController {
  constructor(private readonly realtime: RealtimeGateway) {}

  @MessagePattern(RMQ_EVENTS.ORDER_CREATED)
  onOrderCreated(@Payload() data: { orderId: string; userId: string }) {
    // The notifications service has written the row by now (or will shortly);
    // the bell refetches the authoritative list either way.
    this.realtime.emitNotification(data.userId);
    return { received: true };
  }

  @MessagePattern(RMQ_EVENTS.ORDER_STATUS_CHANGED)
  onOrderStatusChanged(
    @Payload() data: { orderId: string; userId: string; status: OrderStatus; updatedAt: string },
  ) {
    this.realtime.emitOrderStatus(data.userId, {
      orderId: data.orderId,
      status: data.status,
      updatedAt: data.updatedAt,
    });
    this.realtime.emitNotification(data.userId);
    return { received: true };
  }

  @EventPattern(RMQ_EVENTS.TICKET_MESSAGE_CREATED)
  onTicketMessage(
    @Payload()
    data: {
      ticketId: string;
      ticketOwnerId: string;
      message: unknown;
      /** Whom to light the bell for — absent when the author is the only one who would see it. */
      notifyUserId?: string | null;
    },
  ) {
    this.realtime.emitTicketMessage(data.ticketId, data.ticketOwnerId, data.message);
    if (data.notifyUserId) this.realtime.emitNotification(data.notifyUserId);
  }
}
