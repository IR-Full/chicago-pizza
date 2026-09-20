import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { NotificationBell } from './notification-bell';

const user = vi.fn(() => ({ data: { id: 'user-1' } as Record<string, unknown> | null }));
const notifications = vi.fn(() => ({ data: FEED as Record<string, unknown> | undefined }));
const markRead = { mutate: vi.fn(), isPending: false };
const socketEvent = vi.fn();
const invalidate = vi.fn();

const note = (overrides: Record<string, unknown> = {}) => ({
  id: 'n1',
  type: 'ORDER_STATUS',
  title: 'Заказ в пути',
  body: 'Курьер выехал',
  isRead: false,
  createdAt: '2026-09-16T10:00:00.000Z',
  ...overrides,
});

const FEED = { items: [note()], unread: 1, total: 1, page: 1, limit: 20, totalPages: 1 };

vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => user() }));
vi.mock('@/entities/support/queries', () => ({
  useNotifications: () => notifications(),
  useMarkNotificationsRead: () => markRead,
  supportKeys: { notifications: ['notifications'] },
}));
vi.mock('@/shared/lib/use-socket-event', () => ({
  useSocketEvent: (...args: unknown[]) => socketEvent(...args),
}));
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { ...actual, useQueryClient: () => ({ invalidateQueries: invalidate }) };
});

beforeEach(() => {
  vi.clearAllMocks();
  user.mockReturnValue({ data: { id: 'user-1' } });
  notifications.mockReturnValue({ data: FEED });
});

describe('NotificationBell — visibility', () => {
  it('shows nothing to a guest', () => {
    user.mockReturnValue({ data: null });
    const { container } = renderWithProviders(<NotificationBell />);

    expect(container).toBeEmptyDOMElement();
  });

  it('counts the unread ones on the bell', () => {
    renderWithProviders(<NotificationBell />);

    expect(screen.getByLabelText('1 непрочитанных')).toHaveTextContent('1');
  });

  it('caps a large counter so it cannot stretch the header', () => {
    notifications.mockReturnValue({ data: { ...FEED, unread: 23 } });
    renderWithProviders(<NotificationBell />);

    expect(screen.getByLabelText('23 непрочитанных')).toHaveTextContent('9+');
  });

  it('drops the badge entirely when everything is read', () => {
    notifications.mockReturnValue({ data: { ...FEED, unread: 0 } });
    renderWithProviders(<NotificationBell />);

    expect(screen.queryByLabelText(/непрочитанных/)).not.toBeInTheDocument();
  });

  it('survives a feed that has not loaded yet', () => {
    notifications.mockReturnValue({ data: undefined });

    expect(() => renderWithProviders(<NotificationBell />)).not.toThrow();
    expect(screen.getByRole('button', { name: 'Уведомления' })).toBeInTheDocument();
  });
});

describe('NotificationBell — panel', () => {
  const openPanel = () => {
    renderWithProviders(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
  };

  it('stays closed until the bell is clicked', () => {
    renderWithProviders(<NotificationBell />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists the notifications with their time', () => {
    openPanel();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Заказ в пути')).toBeInTheDocument();
    expect(screen.getByText('Курьер выехал')).toBeInTheDocument();
  });

  it('says so when there is nothing', () => {
    notifications.mockReturnValue({ data: { ...FEED, items: [], unread: 0 } });
    openPanel();

    expect(screen.getByText('Пока ничего нет')).toBeInTheDocument();
  });

  it('marks one as read on click', () => {
    openPanel();

    fireEvent.click(screen.getByText('Заказ в пути'));

    expect(markRead.mutate).toHaveBeenCalledWith('n1');
  });

  it('does not re-mark something already read', () => {
    notifications.mockReturnValue({ data: { ...FEED, items: [note({ isRead: true })], unread: 0 } });
    openPanel();

    fireEvent.click(screen.getByText('Заказ в пути'));

    expect(markRead.mutate).not.toHaveBeenCalled();
  });

  it('marks the whole list read', () => {
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Прочитать все' }));

    expect(markRead.mutate).toHaveBeenCalledWith(undefined);
  });

  it('offers no bulk action when nothing is unread', () => {
    notifications.mockReturnValue({ data: { ...FEED, unread: 0 } });
    openPanel();

    expect(screen.queryByRole('button', { name: 'Прочитать все' })).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    openPanel();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the click lands outside it', () => {
    openPanel();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays open while clicking inside it', () => {
    openPanel();

    fireEvent.mouseDown(screen.getByRole('dialog'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('NotificationBell — realtime', () => {
  it('refetches the list when the gateway pings the user room', () => {
    renderWithProviders(<NotificationBell />);

    const [event, handler, enabled] = socketEvent.mock.calls[0] as [string, () => void, boolean];
    expect(event).toBe('notification');
    expect(enabled).toBe(true);

    handler();
    // The ping carries no payload worth trusting — the list is refetched.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });

  it('does not subscribe for a guest', () => {
    user.mockReturnValue({ data: null });
    renderWithProviders(<NotificationBell />);

    expect(socketEvent.mock.calls[0][2]).toBe(false);
  });
});
