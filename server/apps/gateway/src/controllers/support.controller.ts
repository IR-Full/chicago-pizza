import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import {
  CurrentUser,
  JwtPayload,
  NOTIFICATIONS_PATTERNS,
  PaginationDto,
  Public,
  rpcSend,
  SUPPORT_PATTERNS,
} from '@chicago-pizza/common';
import { AddTicketMessageDto, CreateTicketDto, SubscribePushDto } from '../dto/support.dto';

@ApiTags('support & notifications')
@ApiCookieAuth()
@Controller()
export class SupportController {
  constructor(
    @Inject('SUPPORT_SERVICE') private readonly support: ClientProxy,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notifications: ClientProxy,
  ) {}

  @Post('support/tickets')
  @ApiOperation({ summary: 'Создать обращение или начать чат с поддержкой' })
  createTicket(@CurrentUser() user: JwtPayload, @Body() dto: CreateTicketDto) {
    return rpcSend(this.support, SUPPORT_PATTERNS.CREATE_TICKET, { userId: user.sub, ...dto });
  }

  @Get('support/tickets')
  listTickets(@CurrentUser() user: JwtPayload, @Query() query: PaginationDto) {
    return rpcSend(this.support, SUPPORT_PATTERNS.LIST_TICKETS, {
      userId: user.sub,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('support/tickets/:id')
  getTicket(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) ticketId: string) {
    return rpcSend(this.support, SUPPORT_PATTERNS.GET_TICKET, {
      userId: user.sub,
      role: user.role,
      ticketId,
    });
  }

  @Post('support/tickets/:id/messages')
  @ApiOperation({ summary: 'Отправить сообщение в обращение (рассылается по WebSocket)' })
  async addMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) ticketId: string,
    @Body() dto: AddTicketMessageDto,
  ) {
    // The live push is not this controller's job: the support service
    // publishes `ticket.message.created`, and the gateway's event consumer
    // turns it into a broadcast. Doing it here tied "the thread updates" to
    // "this particular endpoint was called".
    const result = await rpcSend<{ message: unknown; ticketOwnerId: string }>(
      this.support,
      SUPPORT_PATTERNS.ADD_MESSAGE,
      { userId: user.sub, role: user.role, ticketId, message: dto.message },
    );

    return result.message;
  }

  @Patch('support/tickets/:id/close')
  closeTicket(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) ticketId: string) {
    return rpcSend(this.support, SUPPORT_PATTERNS.CLOSE_TICKET, {
      userId: user.sub,
      role: user.role,
      ticketId,
    });
  }

  // ── Notifications ────────────────────────────────────────────

  @Get('notifications')
  listNotifications(@CurrentUser() user: JwtPayload, @Query() query: PaginationDto) {
    return rpcSend(this.notifications, NOTIFICATIONS_PATTERNS.LIST_NOTIFICATIONS, {
      userId: user.sub,
      page: query.page,
      limit: query.limit,
    });
  }

  @Patch('notifications/read')
  @ApiOperation({ summary: 'Отметить уведомления прочитанными (все или одно)' })
  markRead(@CurrentUser() user: JwtPayload, @Query('id') notificationId?: string) {
    return rpcSend(this.notifications, NOTIFICATIONS_PATTERNS.MARK_READ, {
      userId: user.sub,
      notificationId,
    });
  }

  @Public()
  @Get('notifications/vapid-key')
  @ApiOperation({ summary: 'Публичный VAPID-ключ для подписки браузера (null, если push выключен)' })
  vapidKey() {
    // Served at runtime rather than inlined into the client bundle: rotating
    // the pair then does not need a rebuild, and a shop without keys simply
    // gets `null` and never offers the toggle.
    return rpcSend(this.notifications, NOTIFICATIONS_PATTERNS.VAPID_PUBLIC_KEY, {});
  }

  @Post('notifications/push-subscription')
  @ApiOperation({ summary: 'Сохранить Web Push подписку браузера' })
  subscribePush(@CurrentUser() user: JwtPayload, @Body() dto: SubscribePushDto) {
    return rpcSend(this.notifications, NOTIFICATIONS_PATTERNS.SUBSCRIBE_PUSH, {
      userId: user.sub,
      endpoint: dto.endpoint,
      keys: dto.keys,
    });
  }
}
