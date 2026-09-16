import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import SupportPage from './page';

const toast = { success: vi.fn(), error: vi.fn() };
const user = vi.fn(() => ({ data: { id: 'user-1' } as Record<string, unknown> | null, isLoading: false }));
const tickets = vi.fn(() => ({ data: [TICKET] as Record<string, unknown>[] }));
const createTicket = { mutateAsync: vi.fn(), isPending: false };
const closeTicket = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

const TICKET = {
  id: 't1',
  subject: 'Холодная пицца',
  status: 'OPEN',
  channel: 'TICKET',
  createdAt: '2026-09-16T10:00:00.000Z',
  updatedAt: '2026-09-16T10:00:00.000Z',
  messages: [{ id: 'm1', message: 'Привезли холодной', senderId: 'user-1', createdAt: '2026-09-16T10:00:00.000Z' }],
};

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
  tickets.mockReturnValue({ data: [TICKET] });
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
    tickets.mockReturnValue({ data: [] });
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
