import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/utils';
import { supportApi } from './api';
import {
  supportKeys,
  useCloseTicket,
  useCreateTicket,
  useNotifications,
  useSendTicketMessage,
  useTicket,
  useTickets,
} from './queries';

const currentUser = vi.fn(() => ({ data: { id: 'user-1' } as { id: string } | null }));

vi.mock('@/entities/user/queries', () => ({
  useCurrentUser: () => currentUser(),
  userKeys: { me: ['user', 'me'] },
}));

vi.mock('./api', () => ({
  supportApi: {
    createTicket: vi.fn(),
    listTickets: vi.fn(),
    getTicket: vi.fn(),
    addMessage: vi.fn(),
    closeTicket: vi.fn(),
    notifications: vi.fn(),
    markRead: vi.fn(),
  },
}));

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockReturnValue({ data: { id: 'user-1' } });
  vi.mocked(supportApi.listTickets).mockResolvedValue([{ id: 't1' }] as never);
  vi.mocked(supportApi.getTicket).mockResolvedValue({ id: 't1', messages: [] } as never);
  vi.mocked(supportApi.createTicket).mockResolvedValue({ id: 't2' } as never);
  vi.mocked(supportApi.addMessage).mockResolvedValue({ id: 'm1' } as never);
  vi.mocked(supportApi.closeTicket).mockResolvedValue({ id: 't1', status: 'CLOSED' } as never);
  vi.mocked(supportApi.notifications).mockResolvedValue({ items: [], unread: 0 } as never);
});

describe('useTickets', () => {
  it('lists the customer’s tickets', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useTickets(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([{ id: 't1' }]));
  });

  it('is skipped for a guest', () => {
    currentUser.mockReturnValue({ data: null });
    const { wrapper } = setup();

    renderHook(() => useTickets(), { wrapper });

    expect(supportApi.listTickets).not.toHaveBeenCalled();
  });
});

describe('useTicket', () => {
  it('loads one thread', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useTicket('t1'), { wrapper });

    await waitFor(() => expect(result.current.data).toMatchObject({ id: 't1' }));
    expect(supportApi.getTicket).toHaveBeenCalledWith('t1');
  });

  it('stays idle without an id', () => {
    const { wrapper } = setup();

    renderHook(() => useTicket(''), { wrapper });

    expect(supportApi.getTicket).not.toHaveBeenCalled();
  });
});

describe('ticket mutations', () => {
  it('creates a ticket and refreshes the list', async () => {
    const { wrapper, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateTicket(), { wrapper });
    result.current.mutate({ subject: 'Тема', message: 'Текст', channel: 'CHAT' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(supportApi.createTicket).toHaveBeenCalledWith('Тема', 'Текст', 'CHAT');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: supportKeys.tickets });
  });

  it('refetches the thread after sending, even though the socket also pushes', async () => {
    const { wrapper, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSendTicketMessage(), { wrapper });
    result.current.mutate({ ticketId: 't1', message: 'Привет' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A dropped socket must not leave the thread stale.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: supportKeys.ticket('t1') });
  });

  it('refreshes both the thread and the list when closing', async () => {
    const { wrapper, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCloseTicket(), { wrapper });
    result.current.mutate('t1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: supportKeys.ticket('t1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: supportKeys.tickets });
  });
});

describe('useNotifications', () => {
  it('loads the first page for a signed-in customer', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useNotifications(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(supportApi.notifications).toHaveBeenCalled();
  });

  it('is skipped for a guest', () => {
    currentUser.mockReturnValue({ data: null });
    const { wrapper } = setup();

    renderHook(() => useNotifications(), { wrapper });

    expect(supportApi.notifications).not.toHaveBeenCalled();
  });
});
