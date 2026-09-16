import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientProxy } from '@nestjs/microservices';
import {
  CurrentUser,
  JwtPayload,
  NOTIFICATIONS_PATTERNS,
  rpcSend,
  SUPPORT_PATTERNS,
} from '@chicago-pizza/common';
import { AddTicketMessageDto, CreateTicketDto, SubscribePushDto } from '../dto/support.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@ApiTags('support & notifications')
@ApiCookieAuth()
@Controller()
export class SupportController {
  constructor(
    @Inject('SUPPORT_SERVICE') private readonly support: ClientProxy,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notifications: ClientProxy,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Post('support/tickets')
  @ApiOperation({ summary: 'Создать обращение или начать чат с поддержкой' })
  createTicket(@CurrentUser() user: JwtPayload, @Body() dto: CreateTicketDto) {
    return rpcSend(this.support, SUPPORT_PATTERNS.CREATE_TICKET, { userId: user.sub, ...dto });
  }

  @Get('support/tickets')
  listTickets(@CurrentUser() user: JwtPayload) {
    return rpcSend(this.support, SUPPORT_PATTERNS.LIST_TICKETS, { userId: user.sub });
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
    const result = await rpcSend<{ message: unknown; ticketOwnerId: string }>(
      this.support,
      SUPPORT_PATTERNS.ADD_MESSAGE,
      { userId: user.sub, role: user.role, ticketId, message: dto.message },
    );

    this.realtime.emitTicketMessage(ticketId, result.ticketOwnerId, result.message);
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
  listNotifications(
    @CurrentUser() user: JwtPayload,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return rpcSend(this.notifications, NOTIFICATIONS_PATTERNS.LIST_NOTIFICATIONS, {
      userId: user.sub,
      page: Number(page),
      limit: Number(limit),
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
