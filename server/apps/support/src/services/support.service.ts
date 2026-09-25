import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService, Role, TicketChannel, TicketStatus } from '@chicago-pizza/prisma';
import { paginate, RMQ_EVENTS } from '@chicago-pizza/common';

const STAFF_ROLES: Role[] = [Role.ADMIN, Role.SUPPORT];

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notifications: ClientProxy,
    @Inject('REALTIME_SERVICE') private readonly realtime: ClientProxy,
  ) {}

  async createTicket(userId: string, subject: string, message: string, channel: TicketChannel) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject,
        channel,
        messages: { create: { senderId: userId, senderRole: Role.USER, message } },
      },
      include: { messages: true },
    });
    return ticket;
  }

  /**
   * A customer's own tickets, newest activity first.
   *
   * Paginated like every other list in the project — this was the one that
   * was not, so a long-standing customer's sidebar fetched every conversation
   * they had ever opened, with the opening message of each.
   */
  async listTickets(userId: string, page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where: { userId },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supportTicket.count({ where: { userId } }),
    ]);

    return paginate(items, total, { page, limit });
  }

  async getTicket(userId: string, role: Role, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { sender: { select: { id: true, firstName: true, role: true } } },
        },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Обращение не найдено');
    if (ticket.userId !== userId && !STAFF_ROLES.includes(role)) {
      throw new ForbiddenException('Нет доступа к этому обращению');
    }
    return ticket;
  }

  /**
   * Appends a message. Returns the saved message plus the id of the user who
   * should be notified — the gateway uses it to route the WebSocket push, and
   * notifications uses it for the email fallback.
   */
  async addMessage(senderId: string, senderRole: Role, ticketId: string, message: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Обращение не найдено');
    if (ticket.userId !== senderId && !STAFF_ROLES.includes(senderRole)) {
      throw new ForbiddenException('Нет доступа к этому обращению');
    }
    if (ticket.status === TicketStatus.CLOSED) {
      throw new ForbiddenException('Обращение закрыто');
    }

    const saved = await this.prisma.ticketMessage.create({
      data: { ticketId, senderId, senderRole, message },
      include: { sender: { select: { id: true, firstName: true, role: true } } },
    });

    // A staff reply moves an OPEN ticket into IN_PROGRESS automatically.
    if (STAFF_ROLES.includes(senderRole) && ticket.status === TicketStatus.OPEN) {
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.IN_PROGRESS },
      });
    } else {
      // `@updatedAt` on the model does the stamping; an empty `data` would be
      // rejected, so the touch names the field it is already setting.
      await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: ticket.status } });
    }

    const isStaffReply = STAFF_ROLES.includes(senderRole);

    // Everyone watching the thread sees every message — that is what makes it
    // a chat rather than an inbox. Published from here rather than from the
    // HTTP controller so the fan-out follows the fact, not the request that
    // caused it.
    this.realtime.emit(RMQ_EVENTS.TICKET_MESSAGE_CREATED, {
      ticketId,
      ticketOwnerId: ticket.userId,
      message: saved,
      // Only a reply lights the customer's bell; nudging the author about
      // their own message would just cause a pointless refetch.
      notifyUserId: isStaffReply ? ticket.userId : null,
    });

    // A letter, on the other hand, goes out only when staff answer.
    if (isStaffReply) {
      this.notifications.emit(RMQ_EVENTS.TICKET_MESSAGE_CREATED, {
        ticketId,
        recipientId: ticket.userId,
        subject: ticket.subject,
      });
    }

    return {
      message: saved,
      ticketOwnerId: ticket.userId,
      isStaffReply,
    };
  }

  async closeTicket(userId: string, role: Role, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Обращение не найдено');
    if (ticket.userId !== userId && !STAFF_ROLES.includes(role)) {
      throw new ForbiddenException('Нет доступа к этому обращению');
    }

    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.CLOSED },
    });
  }

  // ── Personal data ────────────────────────────────────────────

  /** This domain's share of a data export: the conversations themselves. */
  async exportForUser(userId: string) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      tickets: tickets.map((ticket) => ({
        subject: ticket.subject,
        status: ticket.status,
        channel: ticket.channel,
        openedAt: ticket.createdAt,
        messages: ticket.messages.map((message) => ({
          from: message.senderId === userId ? 'customer' : 'support',
          text: message.message,
          sentAt: message.createdAt,
        })),
      })),
    };
  }

  /**
   * Erasure, this domain's half. A support thread is almost entirely free
   * text the customer typed — an address, a phone number, a complaint about a
   * neighbour — so the messages go rather than being detached. The ticket
   * shells stay so support statistics do not develop holes.
   */
  async anonymizeUser(userId: string): Promise<{ success: true }> {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { userId },
      select: { id: true },
    });
    if (!tickets.length) return { success: true };

    const ticketIds = tickets.map((ticket) => ticket.id);
    await this.prisma.$transaction([
      this.prisma.ticketMessage.updateMany({
        where: { ticketId: { in: ticketIds } },
        data: { message: '[сообщение удалено по запросу пользователя]' },
      }),
      this.prisma.supportTicket.updateMany({
        where: { id: { in: ticketIds } },
        data: { subject: '[обращение удалено]', status: TicketStatus.CLOSED },
      }),
    ]);

    return { success: true };
  }

  async adminListTickets(params: { page: number; limit: number; status?: TicketStatus }) {
    const where = params.status ? { status: params.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return paginate(items, total, params);
  }
}
