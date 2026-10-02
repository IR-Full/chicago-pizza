import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import { ChatThread } from './chat-thread';
import { SupportChatWidget } from './support-chat-widget';

const pathname = vi.fn(() => '/menu');
const user = vi.fn(() => ({ data: { id: 'user-1' } as Record<string, unknown> | null }));
const tickets = vi.fn(() => ({
  data: { items: [], totalPages: 1 } as { items: Record<string, unknown>[]; totalPages: number },
}));
const ticket = vi.fn((_id?: string) => ({ data: undefined as Record<string, unknown> | undefined }));
const createTicket = { mutateAsync: vi.fn(), isPending: false };
const sendMessage = { mutateAsync: vi.fn(), isPending: false };
const toast = { success: vi.fn(), error: vi.fn() };
const socketEvent = vi.fn();
const socketRoom = vi.fn();

vi.mock('next/navigation', () => ({ usePathname: () => pathname() }));
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a) },
}));
vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => user() }));
vi.mock('@/entities/support/queries', () => ({
  useTickets: () => tickets(),
  useTicket: (id: string) => ticket(id),
  useCreateTicket: () => createTicket,
  useSendTicketMessage: () => sendMessage,
  supportKeys: { tickets: ['support', 'tickets'], ticket: (id: string) => ['support', 'ticket', id] },
}));
vi.mock('@/shared/lib/use-socket-event', () => ({
  useSocketEvent: (...args: unknown[]) => socketEvent(...args),
  useSocketRoom: (...args: unknown[]) => socketRoom(...args),
}));

const MESSAGES = [
  {
    id: 'm1',
    senderId: 'user-1',
    senderRole: 'USER',
    message: 'Пицца приехала холодной',
    createdAt: '2026-09-16T10:00:00.000Z',
    sender: { id: 'user-1', firstName: 'Амина', role: 'USER' },
  },
  {
    id: 'm2',
    senderId: 'support-1',
    senderRole: 'SUPPORT',
    message: 'Уже разбираемся',
    createdAt: '2026-09-16T10:05:00.000Z',
    sender: { id: 'support-1', firstName: 'Марат', role: 'SUPPORT' },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  pathname.mockReturnValue('/menu');
  user.mockReturnValue({ data: { id: 'user-1', role: 'USER' } });
  tickets.mockReturnValue({ data: { items: [], totalPages: 1 } });
  ticket.mockReturnValue({ data: { id: 't1', status: 'OPEN', messages: MESSAGES } });
  createTicket.mutateAsync.mockResolvedValue({ id: 't1' });
  sendMessage.mutateAsync.mockResolvedValue({ id: 'm3' });
});

describe('SupportChatWidget — visibility', () => {
  it('shows the launcher to a signed-in customer', () => {
    renderWithProviders(<SupportChatWidget />);

    expect(screen.getByRole('button', { name: 'Поддержка' })).toBeInTheDocument();
  });

  it('stays hidden from a guest', () => {
    user.mockReturnValue({ data: null });
    const { container } = renderWithProviders(<SupportChatWidget />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([['/support'], ['/support/t1'], ['/admin'], ['/admin/tickets']])(
    'stays hidden on %s, which has its own chat UI',
    (path) => {
      pathname.mockReturnValue(path);
      const { container } = renderWithProviders(<SupportChatWidget />);

      expect(container).toBeEmptyDOMElement();
    },
  );
});

describe('SupportChatWidget — starting a chat', () => {
  it('opens and closes the panel', () => {
    renderWithProviders(<SupportChatWidget />);

    fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }));
    expect(screen.getByLabelText('Сообщение')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }));
    expect(screen.queryByLabelText('Сообщение')).not.toBeInTheDocument();
  });

  it('creates a chat ticket from the first message', async () => {
    renderWithProviders(<SupportChatWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }));

    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Здравствуйте' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() =>
      expect(createTicket.mutateAsync).toHaveBeenCalledWith({
        subject: 'Онлайн-чат',
        message: 'Здравствуйте',
        channel: 'CHAT',
      }),
    );
  });

  it('refuses to send an empty message', () => {
    renderWithProviders(<SupportChatWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }));

    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  });

  it('reports a failure to open the chat', async () => {
    createTicket.mutateAsync.mockRejectedValue(new ApiError('Слишком много обращений', 400));
    renderWithProviders(<SupportChatWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }));

    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Здравствуйте' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Слишком много обращений'));
  });

  it('shows the running conversation once a chat ticket exists', () => {
    tickets.mockReturnValue({
      data: { items: [{ id: 't1', channel: 'CHAT', status: 'OPEN' }], totalPages: 1 },
    });
    renderWithProviders(<SupportChatWidget />);

    fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }));

    expect(screen.getByText('Пицца приехала холодной')).toBeInTheDocument();
  });

  it('ignores a closed chat and offers to start a new one', () => {
    tickets.mockReturnValue({
      data: { items: [{ id: 't1', channel: 'CHAT', status: 'CLOSED' }], totalPages: 1 },
    });
    renderWithProviders(<SupportChatWidget />);

    fireEvent.click(screen.getByRole('button', { name: 'Поддержка' }));

    expect(screen.getByLabelText('Сообщение')).toBeInTheDocument();
  });
});

describe('ChatThread', () => {
  it('renders the thread with authors and times', () => {
    renderWithProviders(<ChatThread ticketId="t1" />);

    expect(screen.getByText('Пицца приехала холодной')).toBeInTheDocument();
    expect(screen.getByText('Уже разбираемся')).toBeInTheDocument();
    // Only the other side is attributed; own messages need no name.
    expect(screen.getByText('Марат')).toBeInTheDocument();
    expect(screen.queryByText('Амина')).not.toBeInTheDocument();
  });

  it('joins the ticket room and listens for pushes', () => {
    renderWithProviders(<ChatThread ticketId="t1" />);

    expect(socketRoom).toHaveBeenCalledWith('ticket:subscribe', { ticketId: 't1' });
    expect(socketEvent).toHaveBeenCalledWith('ticket:message', expect.any(Function));
  });

  it('refetches only when the push belongs to this ticket', () => {
    const { queryClient } = renderWithProviders(<ChatThread ticketId="t1" />);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const handler = socketEvent.mock.calls[0][1] as (payload: unknown) => void;

    handler({ ticketId: 'other', message: { id: 'm9' } });
    expect(invalidate).not.toHaveBeenCalled();

    handler({ ticketId: 't1', message: { id: 'm9' } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['support', 'ticket', 't1'] });
  });

  it('sends a message and clears the box', async () => {
    renderWithProviders(<ChatThread ticketId="t1" />);

    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Спасибо' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() =>
      expect(sendMessage.mutateAsync).toHaveBeenCalledWith({ ticketId: 't1', message: 'Спасибо' }),
    );
    expect(screen.getByLabelText('Сообщение')).toHaveValue('');
  });

  it('restores the draft when sending fails, so nothing is lost', async () => {
    sendMessage.mutateAsync.mockRejectedValue(new ApiError('Обращение закрыто', 403));
    renderWithProviders(<ChatThread ticketId="t1" />);

    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Спасибо' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(screen.getByLabelText('Сообщение')).toHaveValue('Спасибо'));
    expect(toast.error).toHaveBeenCalledWith('Обращение закрыто');
  });

  it('never sends whitespace', () => {
    renderWithProviders(<ChatThread ticketId="t1" />);

    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  });

  it('replaces the composer with a notice on a closed ticket', () => {
    ticket.mockReturnValue({ data: { id: 't1', status: 'CLOSED', messages: MESSAGES } });
    renderWithProviders(<ChatThread ticketId="t1" />);

    expect(screen.getByText('Обращение закрыто')).toBeInTheDocument();
    expect(screen.queryByLabelText('Сообщение')).not.toBeInTheDocument();
  });

  it('renders an empty thread while it loads', () => {
    ticket.mockReturnValue({ data: undefined });

    expect(() => renderWithProviders(<ChatThread ticketId="t1" />)).not.toThrow();
  });
});

/**
 * Which side a message sits on is a question about *parties*, not accounts.
 * Comparing sender ids to the viewer's id looked right in the customer's own
 * inbox and fell apart everywhere else: in the admin panel a colleague's
 * reply rendered as if the customer had sent it, and an operator reading a
 * ticket they had opened themselves saw both of their roles collapse onto one
 * side in one colour.
 */
describe('ChatThread — who is on which side', () => {
  const sideOf = (text: string) => {
    const row = screen.getByText(text).closest('div[class*="justify-"]')!;
    return row.className.includes('justify-end') ? 'right' : 'left';
  };

  const colourOf = (text: string) => {
    const bubble = screen.getByText(text).closest('div[class*="rounded-2xl"]')!;
    return bubble.className.includes('bg-primary') ? 'accent' : 'muted';
  };

  it('puts the customer on their own side and support opposite', () => {
    user.mockReturnValue({ data: { id: 'user-1', role: 'USER' } });
    renderWithProviders(<ChatThread ticketId="t1" />);

    expect(sideOf('Пицца приехала холодной')).toBe('right');
    expect(sideOf('Уже разбираемся')).toBe('left');
    expect(colourOf('Пицца приехала холодной')).not.toBe(colourOf('Уже разбираемся'));
  });

  it('flips the thread for an operator', () => {
    user.mockReturnValue({ data: { id: 'support-9', role: 'SUPPORT' } });
    renderWithProviders(<ChatThread ticketId="t1" />);

    // The shop is on the viewer's side when the viewer works here.
    expect(sideOf('Уже разбираемся')).toBe('right');
    expect(sideOf('Пицца приехала холодной')).toBe('left');
  });

  /** The case that produced the report: one colour, one side. */
  it('keeps a colleague’s reply on the staff side, not the customer’s', () => {
    user.mockReturnValue({ data: { id: 'admin-1', role: 'ADMIN' } });
    renderWithProviders(<ChatThread ticketId="t1" />);

    // 'Марат' is a different account from the viewer, and still the shop.
    expect(sideOf('Уже разбираемся')).toBe('right');
    expect(colourOf('Уже разбираемся')).toBe('accent');
    expect(colourOf('Пицца приехала холодной')).toBe('muted');
  });

  it('names the other party rather than leaving the bubble anonymous', () => {
    user.mockReturnValue({ data: { id: 'admin-1', role: 'ADMIN' } });
    renderWithProviders(<ChatThread ticketId="t1" />);

    expect(screen.getByText('Амина')).toBeInTheDocument();
  });

  it('falls back to a party name when the sender is not expanded', () => {
    user.mockReturnValue({ data: { id: 'user-1', role: 'USER' } });
    ticket.mockReturnValue({
      data: {
        id: 't1',
        status: 'OPEN',
        messages: [
          {
            id: 'm9',
            senderId: 's',
            senderRole: 'ADMIN',
            message: 'Готово',
            createdAt: '2026-09-16T10:00:00.000Z',
          },
        ],
      },
    });
    renderWithProviders(<ChatThread ticketId="t1" />);

    expect(screen.getByText('Поддержка')).toBeInTheDocument();
  });
});
