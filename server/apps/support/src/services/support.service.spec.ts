import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupportService } from './support.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma and transport mocks */

const TICKET = { id: 't1', userId: 'user-1', subject: 'Холодная пицца', status: 'OPEN' };

function createService(ticket: Record<string, any> | null = TICKET) {
  const prisma: Record<string, any> = {
    supportTicket: {
      create: jest.fn(async ({ data }: any) => ({ id: 't1', ...data, messages: [] })),
      findMany: jest.fn(async () => [TICKET]),
      findUnique: jest.fn(async () => ticket),
      update: jest.fn(async ({ data }: any) => ({ ...TICKET, ...data })),
      count: jest.fn(async () => 1),
    },
    ticketMessage: { create: jest.fn(async ({ data }: any) => ({ id: 'm1', ...data })) },
  };
  const notifications = { emit: jest.fn() };

  return { service: new SupportService(prisma as never, notifications as never), prisma, notifications };
}

describe('SupportService — creating and listing', () => {
  it('opens a ticket with the customer’s first message attached', async () => {
    const { service, prisma } = createService();

    await service.createTicket('user-1', 'Холодная пицца', 'Привезли холодной', 'TICKET' as never);

    expect(prisma.supportTicket.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        subject: 'Холодная пицца',
        channel: 'TICKET',
        messages: { create: { senderId: 'user-1', senderRole: 'USER', message: 'Привезли холодной' } },
      },
      include: { messages: true },
    });
  });

  it('records the channel the ticket came through', async () => {
    const { service, prisma } = createService();

    await service.createTicket('user-1', 'Онлайн-чат', 'Здравствуйте', 'CHAT' as never);

    expect(prisma.supportTicket.create.mock.calls[0][0].data.channel).toBe('CHAT');
  });

  it('lists only the caller’s tickets, most recently active first', async () => {
    const { service, prisma } = createService();

    await service.listTickets('user-1');

    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' }, orderBy: { updatedAt: 'desc' } }),
    );
  });
});

describe('SupportService — reading a ticket', () => {
  it('returns the ticket to its owner with the whole thread', async () => {
    const { service, prisma } = createService();

    await expect(service.getTicket('user-1', 'USER' as never, 't1')).resolves.toMatchObject({ id: 't1' });
    expect(prisma.supportTicket.findUnique.mock.calls[0][0].include.messages.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('404s for an unknown ticket', async () => {
    const { service } = createService(null);

    await expect(service.getTicket('user-1', 'USER' as never, 'ghost')).rejects.toThrow(NotFoundException);
  });

  it('refuses another customer’s ticket', async () => {
    const { service } = createService();

    await expect(service.getTicket('user-2', 'USER' as never, 't1')).rejects.toThrow(ForbiddenException);
  });

  it.each([['ADMIN'], ['SUPPORT']])('lets %s read any ticket', async (role) => {
    const { service } = createService();

    await expect(service.getTicket('staff-1', role as never, 't1')).resolves.toMatchObject({ id: 't1' });
  });

  it('does not treat a courier as support staff', async () => {
    const { service } = createService();

    await expect(service.getTicket('courier-1', 'COURIER' as never, 't1')).rejects.toThrow(ForbiddenException);
  });
});

describe('SupportService — adding a message', () => {
  it('404s for an unknown ticket', async () => {
    const { service } = createService(null);

    await expect(service.addMessage('user-1', 'USER' as never, 'ghost', 'Привет')).rejects.toThrow(NotFoundException);
  });

  it('refuses a customer writing into someone else’s ticket', async () => {
    const { service, prisma } = createService();

    await expect(service.addMessage('user-2', 'USER' as never, 't1', 'Привет')).rejects.toThrow(ForbiddenException);
    expect(prisma.ticketMessage.create).not.toHaveBeenCalled();
  });

  it('refuses to append to a closed ticket', async () => {
    const { service } = createService({ ...TICKET, status: 'CLOSED' });

    await expect(service.addMessage('user-1', 'USER' as never, 't1', 'Ещё кое-что')).rejects.toThrow(
      new ForbiddenException('Обращение закрыто'),
    );
  });

  it('saves the message with its sender and role', async () => {
    const { service, prisma } = createService();

    const result = await service.addMessage('user-1', 'USER' as never, 't1', 'Привезли холодной');

    expect(prisma.ticketMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ticketId: 't1', senderId: 'user-1', senderRole: 'USER', message: 'Привезли холодной' },
      }),
    );
    expect(result).toMatchObject({ ticketOwnerId: 'user-1', isStaffReply: false });
  });

  it('moves an open ticket into progress on the first staff reply', async () => {
    const { service, prisma } = createService();

    await service.addMessage('support-1', 'SUPPORT' as never, 't1', 'Уже разбираемся');

    expect(prisma.supportTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'IN_PROGRESS' },
    });
  });

  it('leaves the status alone on a later staff reply', async () => {
    const { service, prisma } = createService({ ...TICKET, status: 'IN_PROGRESS' });

    await service.addMessage('support-1', 'SUPPORT' as never, 't1', 'Ещё сообщение');

    expect(prisma.supportTicket.update.mock.calls[0][0].data).toEqual({ updatedAt: expect.any(Date) });
  });

  it('only bumps the timestamp when the customer writes', async () => {
    const { service, prisma } = createService();

    await service.addMessage('user-1', 'USER' as never, 't1', 'Ещё сообщение');

    expect(prisma.supportTicket.update.mock.calls[0][0].data).toEqual({ updatedAt: expect.any(Date) });
  });

  it('emails the customer when staff replies', async () => {
    const { service, notifications } = createService();

    const result = await service.addMessage('support-1', 'SUPPORT' as never, 't1', 'Уже разбираемся');

    expect(notifications.emit).toHaveBeenCalledWith('ticket.message.created', {
      ticketId: 't1',
      recipientId: 'user-1',
      subject: 'Холодная пицца',
    });
    expect(result.isStaffReply).toBe(true);
  });

  it('does not email the customer about their own message', async () => {
    const { service, notifications } = createService();

    await service.addMessage('user-1', 'USER' as never, 't1', 'Ещё сообщение');

    expect(notifications.emit).not.toHaveBeenCalled();
  });

  it('returns the owner id so the gateway can push over the socket', async () => {
    const { service } = createService();

    await expect(service.addMessage('support-1', 'ADMIN' as never, 't1', 'Ответ')).resolves.toMatchObject({
      ticketOwnerId: 'user-1',
    });
  });
});

describe('SupportService — closing a ticket', () => {
  it('404s for an unknown ticket', async () => {
    const { service } = createService(null);

    await expect(service.closeTicket('user-1', 'USER' as never, 'ghost')).rejects.toThrow(NotFoundException);
  });

  it('refuses to close another customer’s ticket', async () => {
    const { service } = createService();

    await expect(service.closeTicket('user-2', 'USER' as never, 't1')).rejects.toThrow(ForbiddenException);
  });

  it('lets the owner close their own ticket', async () => {
    const { service, prisma } = createService();

    await expect(service.closeTicket('user-1', 'USER' as never, 't1')).resolves.toMatchObject({ status: 'CLOSED' });
    expect(prisma.supportTicket.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { status: 'CLOSED' } });
  });

  it('lets support close any ticket', async () => {
    const { service } = createService();

    await expect(service.closeTicket('support-1', 'SUPPORT' as never, 't1')).resolves.toMatchObject({
      status: 'CLOSED',
    });
  });
});

describe('SupportService — staff inbox', () => {
  it('lists every ticket with its customer and last message', async () => {
    const { service, prisma } = createService();

    await service.adminListTickets({ page: 1, limit: 20 });

    const args = prisma.supportTicket.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ where: {}, orderBy: { updatedAt: 'desc' }, skip: 0, take: 20 });
    expect(args.include.messages).toEqual({ orderBy: { createdAt: 'desc' }, take: 1 });
  });

  it('filters by status', async () => {
    const { service, prisma } = createService();

    await service.adminListTickets({ page: 1, limit: 20, status: 'OPEN' as never });

    expect(prisma.supportTicket.findMany.mock.calls[0][0].where).toEqual({ status: 'OPEN' });
  });

  it('paginates', async () => {
    const { service, prisma } = createService();
    prisma.supportTicket.count.mockResolvedValue(21);

    await expect(service.adminListTickets({ page: 2, limit: 10 })).resolves.toMatchObject({
      total: 21,
      page: 2,
      limit: 10,
      totalPages: 3,
    });
    expect(prisma.supportTicket.findMany.mock.calls[0][0].skip).toBe(10);
  });
});
