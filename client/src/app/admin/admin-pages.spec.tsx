import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { adminApi } from '@/features/admin/api';
import AdminLayout from './layout';
import AdminOrdersPage from './page';
import AdminPromocodesPage from './promocodes/page';
import AdminTicketsPage from './tickets/page';
import AdminUsersPage from './users/page';

const pathname = vi.fn(() => '/admin');
const user = vi.fn(() => ({ data: { id: 'admin-1', role: 'ADMIN' } as Record<string, unknown> | null, isLoading: false }));

vi.mock('next/navigation', () => ({ usePathname: () => pathname(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => user() }));
vi.mock('@/features/admin/api', () => ({
  adminApi: {
    listOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    listPromocodes: vi.fn(),
    createPromocode: vi.fn(),
    listUsers: vi.fn(),
    setUserRole: vi.fn(),
    setUserBlocked: vi.fn(),
    listTickets: vi.fn(),
  },
}));
vi.mock('@/widgets/support-chat/chat-thread', () => ({
  ChatThread: ({ ticketId }: { ticketId: string }) => <div data-testid="thread">{ticketId}</div>,
}));

const ORDER = {
  id: 'abcdef12-3456-7890-1234-567890abcdef',
  status: 'CREATED',
  total: 78000,
  createdAt: '2026-09-16T10:00:00.000Z',
  user: { id: 'user-1', firstName: 'Амина', phone: '+79280000000', email: 'guest@chicago.ru' },
  items: [{ id: 'i1', productName: 'Пепперони', quantity: 1 }],
  address: { city: 'Махачкала', street: 'Ленина', house: '1' },
};

const TICKET = {
  id: 't1',
  subject: 'Холодная пицца',
  status: 'OPEN',
  updatedAt: '2026-09-16T10:00:00.000Z',
  user: { id: 'user-1', firstName: 'Амина', email: 'guest@chicago.ru' },
  messages: [{ id: 'm1', message: 'Привезли холодной', createdAt: '2026-09-16T10:00:00.000Z' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  pathname.mockReturnValue('/admin');
  user.mockReturnValue({ data: { id: 'admin-1', role: 'ADMIN' }, isLoading: false });
  vi.mocked(adminApi.listOrders).mockResolvedValue({ items: [ORDER] } as never);
  vi.mocked(adminApi.updateOrderStatus).mockResolvedValue(ORDER as never);
  vi.mocked(adminApi.listPromocodes).mockResolvedValue([
    { id: 'promo-1', code: 'CHICAGO10', discountType: 'PERCENT', discountValue: 10, usedCount: 3, isActive: true, minOrderAmount: 0, maxUses: null, expiresAt: null },
  ] as never);
  vi.mocked(adminApi.createPromocode).mockResolvedValue({ id: 'promo-2' } as never);
  vi.mocked(adminApi.listUsers).mockResolvedValue({
    items: [
      { id: 'user-1', firstName: 'Амина', lastName: null, email: 'guest@chicago.ru', role: 'USER', isBlocked: false, loyaltyLevel: 'BRONZE', loyaltyPoints: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
  } as never);
  vi.mocked(adminApi.setUserRole).mockResolvedValue({} as never);
  vi.mocked(adminApi.setUserBlocked).mockResolvedValue({} as never);
  vi.mocked(adminApi.listTickets).mockResolvedValue({ items: [TICKET] } as never);
});

describe('AdminLayout — access', () => {
  it('shows skeletons while the session loads', () => {
    user.mockReturnValue({ data: null, isLoading: true });
    const { container } = renderWithProviders(<AdminLayout>panel</AdminLayout>);

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it.each([[null], [{ id: 'user-1', role: 'USER' }]])('refuses %p', (data) => {
    user.mockReturnValue({ data: data as Record<string, unknown> | null, isLoading: false });
    renderWithProviders(<AdminLayout>panel</AdminLayout>);

    expect(screen.getByText('403')).toBeInTheDocument();
    expect(screen.queryByText('panel')).not.toBeInTheDocument();
  });

  it('gives an admin every tab', () => {
    renderWithProviders(<AdminLayout>panel</AdminLayout>);

    for (const tab of ['Заказы', 'Промокоды', 'Пользователи', 'Обращения']) {
      expect(screen.getByRole('link', { name: tab })).toBeInTheDocument();
    }
  });

  it('gives a courier only the orders tab', () => {
    user.mockReturnValue({ data: { id: 'c1', role: 'COURIER' }, isLoading: false });
    renderWithProviders(<AdminLayout>panel</AdminLayout>);

    expect(screen.getByRole('link', { name: 'Заказы' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Пользователи' })).not.toBeInTheDocument();
  });

  it('gives support only the tickets tab', () => {
    user.mockReturnValue({ data: { id: 's1', role: 'SUPPORT' }, isLoading: false });
    renderWithProviders(<AdminLayout>panel</AdminLayout>);

    expect(screen.getByRole('link', { name: 'Обращения' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Заказы' })).not.toBeInTheDocument();
  });

  it('highlights the current tab', () => {
    pathname.mockReturnValue('/admin/users');
    renderWithProviders(<AdminLayout>panel</AdminLayout>);

    expect(screen.getByRole('link', { name: 'Пользователи' }).className).toContain('bg-primary');
  });
});

/** The card of the single seeded order, used to scope status buttons. */
const orderCard = () => screen.getByText(/ABCDEF12/).closest('div[class*="rounded-card"]') as HTMLElement;

describe('AdminOrdersPage', () => {
  it('lists an order with its customer and contents', async () => {
    renderWithProviders(<AdminOrdersPage />);

    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());
    expect(screen.getByText(/Амина/)).toBeInTheDocument();
    expect(screen.getByText(/Пепперони/)).toBeInTheDocument();
  });

  it('filters by status', async () => {
    renderWithProviders(<AdminOrdersPage />);
    await waitFor(() => expect(adminApi.listOrders).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Готовится' }));

    await waitFor(() => expect(adminApi.listOrders).toHaveBeenLastCalledWith(1, 'PREPARING'));
  });

  it('offers only the transitions the state machine allows', async () => {
    renderWithProviders(<AdminOrdersPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    // A freshly created order may only be accepted or cancelled — the status
    // filter chips above carry the same words, so scope to the card.
    const card = orderCard();
    expect(within(card).getByRole('button', { name: 'Принят' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Отменён' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Доставлен' })).not.toBeInTheDocument();
  });

  it('advances the status', async () => {
    renderWithProviders(<AdminOrdersPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    fireEvent.click(within(orderCard()).getByRole('button', { name: 'Принят' }));

    await waitFor(() => expect(adminApi.updateOrderStatus).toHaveBeenCalled());
    expect(vi.mocked(adminApi.updateOrderStatus).mock.calls[0].slice(0, 2)).toEqual([ORDER.id, 'ACCEPTED']);
  });
});

describe('AdminUsersPage', () => {
  it('lists users with their level', async () => {
    renderWithProviders(<AdminUsersPage />);

    await waitFor(() => expect(screen.getByText(/guest@chicago.ru/)).toBeInTheDocument());
    expect(screen.getByText('BRONZE')).toBeInTheDocument();
  });

  it('searches the directory', async () => {
    renderWithProviders(<AdminUsersPage />);
    await waitFor(() => expect(adminApi.listUsers).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'амина' } });

    await waitFor(() => expect(adminApi.listUsers).toHaveBeenLastCalledWith(1, 'амина'), { timeout: 2000 });
  });

  it('changes a role', async () => {
    renderWithProviders(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByLabelText('Роль')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'COURIER' } });

    await waitFor(() => expect(adminApi.setUserRole).toHaveBeenCalled());
    expect(vi.mocked(adminApi.setUserRole).mock.calls[0].slice(0, 2)).toEqual(['user-1', 'COURIER']);
  });

  it('blocks and unblocks', async () => {
    renderWithProviders(<AdminUsersPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Заблокировать' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Заблокировать' }));

    await waitFor(() => expect(adminApi.setUserBlocked).toHaveBeenCalled());
    expect(vi.mocked(adminApi.setUserBlocked).mock.calls[0].slice(0, 2)).toEqual(['user-1', true]);
  });
});

describe('AdminPromocodesPage', () => {
  it('lists promocodes with their usage', async () => {
    renderWithProviders(<AdminPromocodesPage />);

    await waitFor(() => expect(screen.getByText(/CHICAGO10/)).toBeInTheDocument());
    expect(screen.getByText(/Использован: 3/)).toBeInTheDocument();
    expect(screen.getByText('Активен')).toBeInTheDocument();
  });

  it('creates a percent promocode', async () => {
    renderWithProviders(<AdminPromocodesPage />);
    await waitFor(() => expect(adminApi.listPromocodes).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Код'), { target: { value: 'ny2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать промокод' }));

    // React Query passes its own context as a second argument, so the payload
    // itself is what gets asserted.
    await waitFor(() => expect(adminApi.createPromocode).toHaveBeenCalled());
    expect(vi.mocked(adminApi.createPromocode).mock.calls[0][0]).toEqual({
      code: 'NY2027',
      discountType: 'PERCENT',
      discountValue: 10,
      minOrderAmount: 0,
    });
  });
});

describe('AdminTicketsPage', () => {
  it('lists tickets and opens a thread', async () => {
    renderWithProviders(<AdminTicketsPage />);

    await waitFor(() => expect(screen.getByText('Холодная пицца')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Холодная пицца'));
    expect(screen.getByTestId('thread')).toHaveTextContent('t1');
  });

  it('filters by status', async () => {
    renderWithProviders(<AdminTicketsPage />);
    await waitFor(() => expect(adminApi.listTickets).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Закрыто' }));

    await waitFor(() => expect(adminApi.listTickets).toHaveBeenLastCalledWith(1, 'CLOSED'));
  });
});
