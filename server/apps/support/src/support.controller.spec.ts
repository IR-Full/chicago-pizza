import { SUPPORT_PATTERNS } from '@chicago-pizza/common';
import { SupportController } from './support.controller';
import { SupportService } from './services/support.service';

function createController() {
  const support: Record<string, any> = {
    createTicket: jest.fn(async () => ({ id: 't1' })),
    listTickets: jest.fn(async () => []),
    getTicket: jest.fn(async () => ({ id: 't1' })),
    addMessage: jest.fn(async () => ({ message: { id: 'm1' } })),
    closeTicket: jest.fn(async () => ({ id: 't1', status: 'CLOSED' })),
    adminListTickets: jest.fn(async () => ({ items: [] })),
  };

  return { controller: new SupportController(support as unknown as SupportService), support };
}

const patternOf = (method: keyof SupportController): string[] =>
  ([] as string[]).concat(Reflect.getMetadata('microservices:pattern', SupportController.prototype[method]));

describe('SupportController — message routing', () => {
  const routes: [keyof SupportController, string][] = [
    ['createTicket', SUPPORT_PATTERNS.CREATE_TICKET],
    ['listTickets', SUPPORT_PATTERNS.LIST_TICKETS],
    ['getTicket', SUPPORT_PATTERNS.GET_TICKET],
    ['addMessage', SUPPORT_PATTERNS.ADD_MESSAGE],
    ['closeTicket', SUPPORT_PATTERNS.CLOSE_TICKET],
    ['adminListTickets', SUPPORT_PATTERNS.ADMIN_LIST_TICKETS],
  ];

  it.each(routes)('%s listens on %s', (method, pattern) => {
    expect(patternOf(method)).toContain(pattern);
  });
});

describe('SupportController — delegation', () => {
  it('splits the create payload into positional arguments', async () => {
    const { controller, support } = createController();

    await controller.createTicket({
      userId: 'user-1',
      subject: 'Холодная пицца',
      message: 'Привезли холодной',
      channel: 'CHAT' as never,
    });

    expect(support.createTicket).toHaveBeenCalledWith('user-1', 'Холодная пицца', 'Привезли холодной', 'CHAT');
  });

  it('defaults an unspecified channel to a ticket', async () => {
    const { controller, support } = createController();

    await controller.createTicket({ userId: 'user-1', subject: 'Тема', message: 'Текст' });

    expect(support.createTicket).toHaveBeenCalledWith('user-1', 'Тема', 'Текст', 'TICKET');
  });

  it('lists the caller’s tickets', async () => {
    const { controller, support } = createController();

    await controller.listTickets({ userId: 'user-1' });

    expect(support.listTickets).toHaveBeenCalledWith('user-1');
  });

  it('carries the caller role into the read and close paths', async () => {
    const { controller, support } = createController();

    await controller.getTicket({ userId: 'user-1', role: 'SUPPORT' as never, ticketId: 't1' });
    await controller.closeTicket({ userId: 'user-1', role: 'ADMIN' as never, ticketId: 't1' });

    expect(support.getTicket).toHaveBeenCalledWith('user-1', 'SUPPORT', 't1');
    expect(support.closeTicket).toHaveBeenCalledWith('user-1', 'ADMIN', 't1');
  });

  it('passes sender, role, ticket and text when appending a message', async () => {
    const { controller, support } = createController();

    await controller.addMessage({ userId: 'support-1', role: 'SUPPORT' as never, ticketId: 't1', message: 'Ответ' });

    expect(support.addMessage).toHaveBeenCalledWith('support-1', 'SUPPORT', 't1', 'Ответ');
  });

  it('forwards the staff inbox filter', async () => {
    const { controller, support } = createController();

    await controller.adminListTickets({ page: 2, limit: 10, status: 'OPEN' as never });

    expect(support.adminListTickets).toHaveBeenCalledWith({ page: 2, limit: 10, status: 'OPEN' });
  });
});
