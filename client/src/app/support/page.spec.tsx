import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import SupportPage from './page';
import SupportTicketPage from './[id]/page';
import { SupportInbox } from '@/widgets/support-inbox/support-inbox';

const toast = { success: vi.fn(), error: vi.fn() };
const user = vi.fn(() => ({ data: { id: 'user-1' } as Record<string, unknown> | null, isLoading: false }));
const tickets = vi.fn(() => ({
  data: { items: [TICKET], totalPages: 1 } as { items: Record<string, unknown>[]; totalPages: number },
}));
const createTicket = { mutateAsync: vi.fn(), isPending: false };
const closeTicket = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

const TICKET = {
  id: 't1',
  subject: 'Холодная пицца',
  status: 'OPEN',
  channel: 'TICKET',
  createdAt: '2026-09-16T10:00:00.000Z',
  updatedAt: '2026-09-16T10:00:00.000Z',
  messages: [
    { id: 'm1', message: 'Привезли холодной', senderId: 'user-1', createdAt: '2026-09-16T10:00:00.000Z' },
  ],
};

const router = { replace: vi.fn(), push: vi.fn() };

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a) },
}));
vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => user() }));
vi.mock('@/entities/support/queries', () => ({
  useTickets: () => tickets(),
  useCreateTicket: () => createTicket,
  useCloseTicket: () => closeTicket,
  useTicket: () => ({ data: TICKET }),
  useSendTicketMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  supportKeys: { tickets: ['support', 'tickets'], ticket: (id: string) => ['support', 'ticket', id] },
}));
vi.mock('@/shared/lib/use-socket-event', () => ({ useSocketEvent: vi.fn(), useSocketRoom: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  user.mockReturnValue({ data: { id: 'user-1' }, isLoading: false });
  tickets.mockReturnValue({ data: { items: [TICKET], totalPages: 1 } });
  createTicket.mutateAsync.mockResolvedValue({ id: 't2' });
});

describe('SupportPage', () => {
  it('shows a loading notice while the session loads', () => {
    user.mockReturnValue({ data: null, isLoading: true });
    renderWithProviders(<SupportPage />);

    expect(screen.getByText('Загрузка…')).toBeInTheDocument();
  });

  it('asks a guest to sign in', () => {
    user.mockReturnValue({ data: null, isLoading: false });
    renderWithProviders(<SupportPage />);

    expect(screen.getByRole('link', { name: 'Войдите, чтобы продолжить' })).toHaveAttribute(
      'href',
      '/login?redirect=/support',
    );
  });

  it('lists existing tickets with their status', () => {
    renderWithProviders(<SupportPage />);

    expect(screen.getByText('Холодная пицца')).toBeInTheDocument();
    expect(screen.getByText('Открыто')).toBeInTheDocument();
  });

  it('says when there are no tickets', () => {
    tickets.mockReturnValue({ data: { items: [], totalPages: 1 } });
    renderWithProviders(<SupportPage />);

    expect(screen.getAllByText('Обращений пока нет').length).toBeGreaterThan(0);
  });

  it('opens the new-ticket form on request', () => {
    renderWithProviders(<SupportPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Новое обращение' }));

    expect(screen.getByLabelText('Тема')).toBeInTheDocument();
  });

  it('creates a ticket from the form', async () => {
    renderWithProviders(<SupportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Новое обращение' }));

    fireEvent.change(screen.getByLabelText('Тема'), { target: { value: 'Долгая доставка' } });
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Ждём больше часа' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() =>
      expect(createTicket.mutateAsync).toHaveBeenCalledWith({
        subject: 'Долгая доставка',
        message: 'Ждём больше часа',
      }),
    );
  });

  it('reports a refused ticket', async () => {
    createTicket.mutateAsync.mockRejectedValue(new ApiError('Слишком много обращений', 400));
    renderWithProviders(<SupportPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Новое обращение' }));

    fireEvent.change(screen.getByLabelText('Тема'), { target: { value: 'Тема' } });
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Слишком много обращений'));
  });

  it('opens the thread of a chosen ticket', () => {
    renderWithProviders(<SupportPage />);

    fireEvent.click(screen.getByText('Холодная пицца'));

    expect(screen.getByText('Привезли холодной')).toBeInTheDocument();
  });
});

/**
 * The "you have a reply" email links straight to one thread. That address was
 * a 404, so every such letter led nowhere.
 */
describe('SupportPage — a linked thread', () => {
  it('opens the ticket named in the address', () => {
    renderWithProviders(<SupportInbox initialTicketId="t1" />);

    // No click needed: the thread is open on arrival, with the list beside it.
    expect(screen.getByText('Привезли холодной')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Холодная пицца' })).toBeInTheDocument();
  });

  it('puts the chosen ticket in the address so the thread can be shared', () => {
    renderWithProviders(<SupportInbox />);

    fireEvent.click(screen.getByText('Холодная пицца'));

    expect(router.replace).toHaveBeenCalledWith('/support/t1');
  });

  it('lands a new ticket on its own address too', async () => {
    renderWithProviders(<SupportInbox />);

    fireEvent.click(screen.getByRole('button', { name: 'Новое обращение' }));
    fireEvent.change(screen.getByLabelText('Тема'), { target: { value: 'Долгая доставка' } });
    fireEvent.change(screen.getByLabelText('Сообщение'), { target: { value: 'Ждём час' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/support/t2'));
  });

  it('renders the route with the id from the path', async () => {
    const page = await SupportTicketPage({ params: Promise.resolve({ id: 't1' }) });
    renderWithProviders(page);

    expect(screen.getByText('Привезли холодной')).toBeInTheDocument();
  });
});

/**
 * The header row lives in a 20rem column, and the two empty states are
 * different questions. Both were wrong on screen before anyone read the code.
 */
describe('SupportPage — layout and empty states', () => {
  it('lets the header wrap instead of pushing the button out of the column', () => {
    const { container } = renderWithProviders(<SupportInbox />);

    // Unwrapped, the heading plus the button overflowed 320px and slid under
    // the card beside it.
    const header = container.querySelector('h1')!.parentElement!;
    expect(header.className).toContain('flex-wrap');
  });

  it('asks the customer to pick a conversation when they have some', () => {
    renderWithProviders(<SupportInbox />);

    expect(screen.getByText('Выберите обращение из списка')).toBeInTheDocument();
    expect(screen.queryByText('Обращений пока нет')).not.toBeInTheDocument();
  });

  it('invites a first conversation without repeating the left column', () => {
    tickets.mockReturnValue({ data: { items: [], totalPages: 1 } });
    renderWithProviders(<SupportInbox />);

    // The list says "нет обращений"; the pane beside it saying the same thing
    // is the same sentence twice on one screen.
    expect(screen.getByText('Обращений пока нет')).toBeInTheDocument();
    expect(screen.getByText('Откройте обращение — ответим здесь')).toBeInTheDocument();
    expect(screen.queryByText('Выберите обращение из списка')).not.toBeInTheDocument();
  });
});
