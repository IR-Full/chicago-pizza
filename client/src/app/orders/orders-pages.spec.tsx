import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import OrdersPage from './page';
import OrderDetailPage from './[id]/page';

const router = { push: vi.fn() };
const toast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
const socketEvent = vi.fn();
const socketRoom = vi.fn();

const user = vi.fn(() => ({ data: { id: 'user-1' } as Record<string, unknown> | null, isLoading: false }));
const orders = vi.fn(
  (_page?: number) => ({ data: { items: [ORDER], totalPages: 1 } as Record<string, unknown> | undefined, isLoading: false }),
);
const order = vi.fn(() => ({ data: ORDER as Record<string, unknown> | undefined, isLoading: false }));
const repeat = { mutateAsync: vi.fn(), isPending: false, variables: undefined as string | undefined };

const ORDER = {
  id: 'abcdef12-3456-7890-1234-567890abcdef',
  status: 'PREPARING',
  createdAt: '2026-09-16T10:00:00.000Z',
  total: 78000,
  subtotal: 63000,
  discount: 0,
  deliveryFee: 15000,
  paymentMethod: 'CASH_ON_DELIVERY',
  deliveryType: 'ASAP',
  comment: null,
  review: null,
  address: { title: 'Дом', city: 'Махачкала', street: 'Ленина', house: '1', apartment: '5' },
  items: [
    { id: 'i1', productName: 'Пепперони', sizeLabel: '45 см', quantity: 2, totalPrice: 126000 },
  ],
  statusHistory: [{ id: 'h1', status: 'CREATED', changedAt: '2026-09-16T10:00:00.000Z' }],
};

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ id: ORDER.id }),
}));
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toast.error(...a),
    success: (...a: unknown[]) => toast.success(...a),
    info: (...a: unknown[]) => toast.info(...a),
  },
}));
vi.mock('@/shared/lib/use-socket-event', () => ({
  useSocketEvent: (...args: unknown[]) => socketEvent(...args),
  useSocketRoom: (...args: unknown[]) => socketRoom(...args),
}));
vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => user() }));
vi.mock('@/entities/order/queries', () => ({
  useOrders: (page?: number) => orders(page),
  useOrder: () => order(),
  useRepeatOrder: () => repeat,
  useSubmitReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  orderKeys: { detail: (id: string) => ['orders', 'detail', id], list: (page: number) => ['orders', 'list', page] },
}));

beforeEach(() => {
  vi.clearAllMocks();
  user.mockReturnValue({ data: { id: 'user-1' }, isLoading: false });
  orders.mockReturnValue({ data: { items: [ORDER], totalPages: 1 }, isLoading: false });
  order.mockReturnValue({ data: ORDER, isLoading: false });
  repeat.mutateAsync.mockResolvedValue({ lines: [], subtotal: 0, itemCount: 0 });
});

describe('OrdersPage', () => {
  it('shows skeletons while loading', () => {
    orders.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderWithProviders(<OrdersPage />);

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('asks a guest to sign in', () => {
    user.mockReturnValue({ data: null, isLoading: false });
    renderWithProviders(<OrdersPage />);

    expect(screen.getByRole('link', { name: 'Войдите, чтобы продолжить' })).toHaveAttribute(
      'href',
      '/login?redirect=/orders',
    );
  });

  it('says so when there is no history yet', () => {
    orders.mockReturnValue({ data: { items: [], totalPages: 0 }, isLoading: false });
    renderWithProviders(<OrdersPage />);

    expect(screen.getByText('Заказов пока нет')).toBeInTheDocument();
  });

  it('lists an order with its short number, status and contents', () => {
    renderWithProviders(<OrdersPage />);

    expect(screen.getByRole('link', { name: 'Заказ №ABCDEF12' })).toHaveAttribute('href', `/orders/${ORDER.id}`);
    expect(screen.getByText('Готовится')).toBeInTheDocument();
    expect(screen.getByText('Пепперони ×2')).toBeInTheDocument();
    expect(screen.getByText(/780/)).toBeInTheDocument();
  });

  it('repeats an order and sends the customer to the cart', async () => {
    renderWithProviders(<OrdersPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Повторить заказ' }));

    await waitFor(() => expect(repeat.mutateAsync).toHaveBeenCalledWith(ORDER.id));
    expect(router.push).toHaveBeenCalledWith('/cart');
  });

  it('reports when nothing can be repeated', async () => {
    repeat.mutateAsync.mockRejectedValue(new ApiError('Нечего повторить: товары больше не доступны', 400));
    renderWithProviders(<OrdersPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Повторить заказ' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Нечего повторить: товары больше не доступны'));
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('OrdersPage — pagination', () => {
  it('starts on the first page', () => {
    renderWithProviders(<OrdersPage />);

    expect(orders).toHaveBeenCalledWith(1);
  });

  it('hides the controls when the history fits on one page', () => {
    renderWithProviders(<OrdersPage />);

    expect(screen.queryByRole('navigation', { name: 'Страницы' })).not.toBeInTheDocument();
  });

  it('reaches older orders instead of stopping at the last twenty', () => {
    orders.mockReturnValue({ data: { items: [ORDER], totalPages: 4 }, isLoading: false });
    renderWithProviders(<OrdersPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));

    expect(orders).toHaveBeenLastCalledWith(2);
  });
});

describe('OrderDetailPage', () => {
  it('shows skeletons while loading', () => {
    order.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderWithProviders(<OrderDetailPage />);

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('handles an order that is not there', () => {
    order.mockReturnValue({ data: undefined, isLoading: false });
    renderWithProviders(<OrderDetailPage />);

    expect(screen.getByText('Заказов пока нет')).toBeInTheDocument();
  });

  it('shows the number, the status and the tracker', () => {
    renderWithProviders(<OrderDetailPage />);

    expect(screen.getByRole('heading', { name: 'Заказ №ABCDEF12' })).toBeInTheDocument();
    expect(screen.getAllByText('Готовится').length).toBeGreaterThan(0);
    // The tracker renders the five steps as a list of its own.
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
  });

  it('lists the items and the address', () => {
    renderWithProviders(<OrderDetailPage />);

    expect(screen.getByText(/Пепперони/)).toBeInTheDocument();
    expect(screen.getByText(/Ленина/)).toBeInTheDocument();
  });

  it('subscribes to live updates for this order only', () => {
    renderWithProviders(<OrderDetailPage />);

    expect(socketRoom).toHaveBeenCalledWith('order:subscribe', { orderId: ORDER.id });
    expect(socketEvent).toHaveBeenCalledWith('order:status', expect.any(Function));
  });

  it('moves the tracker as soon as a push arrives, then refetches', () => {
    const { queryClient } = renderWithProviders(<OrderDetailPage />);
    const setData = vi.spyOn(queryClient, 'setQueryData');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const handler = socketEvent.mock.calls[0][1] as (payload: unknown) => void;

    handler({ orderId: ORDER.id, status: 'ON_DELIVERY' });

    expect(setData).toHaveBeenCalledWith(['orders', 'detail', ORDER.id], expect.any(Function));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'detail', ORDER.id] });
    expect(toast.info).toHaveBeenCalledWith('Передан курьеру');
  });

  it('ignores a push about a different order', () => {
    const { queryClient } = renderWithProviders(<OrderDetailPage />);
    const setData = vi.spyOn(queryClient, 'setQueryData');
    const handler = socketEvent.mock.calls[0][1] as (payload: unknown) => void;

    handler({ orderId: 'someone-elses-order', status: 'DELIVERED' });

    expect(setData).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('offers a review only once the order has arrived', () => {
    const { unmount } = renderWithProviders(<OrderDetailPage />);
    expect(screen.queryByRole('button', { name: 'Отправить отзыв' })).not.toBeInTheDocument();
    unmount();

    order.mockReturnValue({ data: { ...ORDER, status: 'DELIVERED' }, isLoading: false });
    renderWithProviders(<OrderDetailPage />);
    expect(screen.getByRole('button', { name: 'Отправить отзыв' })).toBeInTheDocument();
  });
});
