import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { NOTIFICATIONS_PATTERNS, RMQ_EVENTS } from '@chicago-pizza/common';
import { OrderStatus } from '@chicago-pizza/prisma';
import { NotificationService } from './services/notification.service';

@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  // ── Domain events (fire-and-forget) ──────────────────────────

  @EventPattern(RMQ_EVENTS.EMAIL_VERIFICATION_REQUESTED)
  onEmailVerification(@Payload() data: { email: string; firstName: string; code: string }) {
    return this.notifications.handleEmailVerification(data);
  }

  @EventPattern(RMQ_EVENTS.PASSWORD_RESET_REQUESTED)
  onPasswordReset(@Payload() data: { email: string; firstName: string; token: string }) {
    return this.notifications.handlePasswordReset(data);
  }

  @EventPattern(RMQ_EVENTS.ORDER_CREATED)
  onOrderCreated(@Payload() data: { orderId: string; userId: string }) {
    return this.notifications.handleOrderCreated(data);
  }

  @EventPattern(RMQ_EVENTS.ORDER_STATUS_CHANGED)
  onOrderStatusChanged(@Payload() data: { orderId: string; userId: string; status: OrderStatus }) {
    return this.notifications.handleOrderStatusChanged(data);
  }

  @EventPattern(RMQ_EVENTS.TICKET_MESSAGE_CREATED)
  onTicketMessage(@Payload() data: { ticketId: string; recipientId: string; subject: string }) {
    return this.notifications.handleTicketMessage(data);
  }

  @EventPattern(RMQ_EVENTS.USER_REGISTERED)
  onUserRegistered() {
    // Welcome flow lives in the verification email for now; the event is
    // consumed so it does not pile up unrouted in the queue.
    return undefined;
  }

  // ── Query API ────────────────────────────────────────────────

  @MessagePattern(NOTIFICATIONS_PATTERNS.LIST_NOTIFICATIONS)
  list(@Payload() payload: { userId: string; page?: number; limit?: number }) {
    return this.notifications.list(payload.userId, payload.page, payload.limit);
  }

  @MessagePattern(NOTIFICATIONS_PATTERNS.MARK_READ)
  markRead(@Payload() payload: { userId: string; notificationId?: string }) {
    return this.notifications.markRead(payload.userId, payload.notificationId);
  }

  @MessagePattern(NOTIFICATIONS_PATTERNS.SUBSCRIBE_PUSH)
  subscribePush(@Payload() payload: { userId: string; endpoint: string; keys: Record<string, string> }) {
    return this.notifications.subscribePush(payload.userId, payload.endpoint, payload.keys);
  }
}
