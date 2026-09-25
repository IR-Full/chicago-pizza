import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { adminApi } from '@/features/admin/api';
import AdminKitchenPage from './page';

const chime = vi.fn();
const user = vi.fn(() => ({ data: { id: 'admin-1', role: 'ADMIN' } as Record<string, unknown> | null }));
const branches = vi.fn(() => ({ data: BRANCHES as Record<string, unknown>[] }));
const socketEvent = vi.fn();

const BRANCHES = [
  { id: 'branch-1', name: 'На Гамзатова' },
  { id: 'branch-2', name: 'На Акушинского' },
];

/** `updatedAt` is when the order entered its current column. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const order = (over: Record<string, unknown> = {}) => ({
  id: 'abcdef12-3456-7890-1234-567890abcdef',
  status: 'CREATED',
  fulfillment: 'DELIVERY',
  total: 78000,
  comment: null,
  createdAt: minutesAgo(1),
  updatedAt: minutesAgo(1),
  items: [{ id: 'i1', productName: 'Пепперони', sizeLabel: '45 см', quantity: 2 }],
  ...over,
});

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => user() }));
vi.mock('@/entities/product/queries', () => ({ useBranches: () => branches() }));
vi.mock('@/shared/lib/use-socket-event', () => ({
  useSocketEvent: (...args: unknown[]) => socketEvent(...args),
}));
vi.mock('@/features/admin/use-new-order-chime', () => ({ useNewOrderChime: () => chime }));
vi.mock('@/features/admin/api', () => ({
  adminApi: { listKitchenOrders: vi.fn(), updateOrderStatus: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  user.mockReturnValue({ data: { id: 'admin-1', role: 'ADMIN' } });
  branches.mockReturnValue({ data: BRANCHES });
  vi.mocked(adminApi.listKitchenOrders).mockResolvedValue({ items: [order()] } as never);
  vi.mocked(adminApi.updateOrderStatus).mockResolvedValue(order() as never);
});

afterEach(() => {
  vi.useRealTimers();
});

const card = () => screen.getByText(/ABCDEF12/).closest('article') as HTMLElement;

describe('AdminKitchenPage — the board', () => {
  it('shows what is on the order, in its column', async () => {
    renderWithProviders(<AdminKitchenPage />);

    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());
    expect(within(card()).getByText(/Пепперони/)).toBeInTheDocument();
    expect(within(card()).getByText(/2×/)).toBeInTheDocument();
  });

  it('asks only for orders that are still in play', async () => {
    renderWithProviders(<AdminKitchenPage />);

    // A board carrying yesterday's delivered orders is a board nobody reads.
    await waitFor(() => expect(adminApi.listKitchenOrders).toHaveBeenCalledWith(undefined));
  });

  it('narrows to one kitchen', async () => {
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(adminApi.listKitchenOrders).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'На Акушинского' }));

    await waitFor(() => expect(adminApi.listKitchenOrders).toHaveBeenLastCalledWith('branch-2'));
  });

  it('says so when everything is closed', async () => {
    vi.mocked(adminApi.listKitchenOrders).mockResolvedValue({ items: [] } as never);
    renderWithProviders(<AdminKitchenPage />);

    expect(await screen.findByText('Пока пусто — все заказы закрыты')).toBeInTheDocument();
  });

  it('marks a collection apart from a delivery', async () => {
    vi.mocked(adminApi.listKitchenOrders).mockResolvedValue({
      items: [order({ fulfillment: 'PICKUP' })],
    } as never);
    renderWithProviders(<AdminKitchenPage />);

    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());
    expect(within(card()).getByText('Самовывоз')).toBeInTheDocument();
  });
});

/**
 * The point of the screen is not "what happened" — the admin list answers
 * that — but "what is late", readable from the other side of the room.
 */
describe('AdminKitchenPage — the clock', () => {
  it('counts the minutes in the current column', async () => {
    vi.mocked(adminApi.listKitchenOrders).mockResolvedValue({
      items: [order({ updatedAt: minutesAgo(7) })],
    } as never);
    renderWithProviders(<AdminKitchenPage />);

    await waitFor(() => expect(screen.getByText('в статусе 7 мин')).toBeInTheDocument());
  });

  it('leaves a fresh order unmarked', async () => {
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    expect(card().className).toContain('border-transparent');
  });

  it('flags an unacknowledged order after two minutes', async () => {
    vi.mocked(adminApi.listKitchenOrders).mockResolvedValue({
      items: [order({ updatedAt: minutesAgo(3) })],
    } as never);
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    expect(card().className).toContain('border-brand-500');
  });

  it('turns an order red when it is not late but a problem', async () => {
    vi.mocked(adminApi.listKitchenOrders).mockResolvedValue({
      items: [order({ updatedAt: minutesAgo(10) })],
    } as never);
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    expect(card().className).toContain('border-destructive');
  });

  /**
   * Twenty minutes in the oven is normal; twenty minutes unacknowledged is
   * not. The thresholds are per column for exactly that reason.
   */
  it('judges the oven by a slower clock than the queue', async () => {
    vi.mocked(adminApi.listKitchenOrders).mockResolvedValue({
      items: [order({ status: 'PREPARING', updatedAt: minutesAgo(10) })],
    } as never);
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    expect(card().className).toContain('border-transparent');
  });
});

describe('AdminKitchenPage — advancing an order', () => {
  it('offers exactly one next step, not every legal move', async () => {
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    // A card with four buttons is a card where the wrong one gets pressed.
    const buttons = within(card()).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('Принят');
  });

  it('advances the order', async () => {
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    fireEvent.click(within(card()).getByRole('button', { name: 'Принят' }));

    await waitFor(() =>
      expect(adminApi.updateOrderStatus).toHaveBeenCalledWith(
        'abcdef12-3456-7890-1234-567890abcdef',
        'ACCEPTED',
      ),
    );
  });

  it('never offers a courier the kitchen’s buttons', async () => {
    user.mockReturnValue({ data: { id: 'courier-1', role: 'COURIER' } });
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    expect(within(card()).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('AdminKitchenPage — the chime', () => {
  it('stays quiet on the first load', async () => {
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    // Arriving at a screen with ten orders on it is not ten pieces of news.
    expect(chime).not.toHaveBeenCalled();
  });

  it('rings when an order the screen has not seen lands on it', async () => {
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    // A second order arrives, and the socket nudges the board to refetch.
    vi.mocked(adminApi.listKitchenOrders).mockResolvedValue({
      items: [order(), order({ id: '99999999-0000-0000-0000-000000000000' })],
    } as never);
    const refetch = socketEvent.mock.calls[0][1] as () => void;
    refetch();

    await waitFor(() => expect(chime).toHaveBeenCalled());
  });

  it('stays quiet when an order merely moves between columns', async () => {
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    // Same id, new status: the board redraws, but nothing arrived.
    vi.mocked(adminApi.listKitchenOrders).mockResolvedValue({
      items: [order({ status: 'PREPARING' })],
    } as never);
    const refetch = socketEvent.mock.calls[0][1] as () => void;
    refetch();

    await waitFor(() => expect(screen.getByText('Готовится')).toBeInTheDocument());
    expect(chime).not.toHaveBeenCalled();
  });

  it('can be switched off', async () => {
    renderWithProviders(<AdminKitchenPage />);
    await waitFor(() => expect(screen.getByText(/ABCDEF12/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Звук включён' }));

    expect(screen.getByRole('button', { name: 'Звук выключен' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('AdminKitchenPage — staying current', () => {
  it('refetches when an order moves anywhere in the shop', () => {
    renderWithProviders(<AdminKitchenPage />);

    // The socket is the fast path; the polling interval is the safety net.
    expect(socketEvent).toHaveBeenCalledWith('order:status', expect.any(Function));
  });
});
