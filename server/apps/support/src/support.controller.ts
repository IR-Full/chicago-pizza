import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { SUPPORT_PATTERNS } from '@chicago-pizza/common';
import { Role, TicketChannel, TicketStatus } from '@chicago-pizza/prisma';
import { SupportService } from './services/support.service';

@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @MessagePattern(SUPPORT_PATTERNS.CREATE_TICKET)
  createTicket(
    @Payload() payload: { userId: string; subject: string; message: string; channel?: TicketChannel },
  ) {
    return this.support.createTicket(
      payload.userId,
      payload.subject,
      payload.message,
      payload.channel ?? TicketChannel.TICKET,
    );
  }

  @MessagePattern(SUPPORT_PATTERNS.LIST_TICKETS)
  listTickets(@Payload() payload: { userId: string }) {
    return this.support.listTickets(payload.userId);
  }

  @MessagePattern(SUPPORT_PATTERNS.GET_TICKET)
  getTicket(@Payload() payload: { userId: string; role: Role; ticketId: string }) {
    return this.support.getTicket(payload.userId, payload.role, payload.ticketId);
  }

  @MessagePattern(SUPPORT_PATTERNS.ADD_MESSAGE)
  addMessage(@Payload() payload: { userId: string; role: Role; ticketId: string; message: string }) {
    return this.support.addMessage(payload.userId, payload.role, payload.ticketId, payload.message);
  }

  @MessagePattern(SUPPORT_PATTERNS.CLOSE_TICKET)
  closeTicket(@Payload() payload: { userId: string; role: Role; ticketId: string }) {
    return this.support.closeTicket(payload.userId, payload.role, payload.ticketId);
  }

  @MessagePattern(SUPPORT_PATTERNS.ADMIN_LIST_TICKETS)
  adminListTickets(@Payload() payload: { page: number; limit: number; status?: TicketStatus }) {
    return this.support.adminListTickets(payload);
  }
}
