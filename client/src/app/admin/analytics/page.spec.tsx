import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { adminApi } from '@/features/admin/api';
import AdminAnalyticsPage from './page';

const branches = vi.fn(() => ({ data: [{ id: 'branch-1', name: 'На Гамзатова' }] }));

const SUMMARY = {
  revenue: 1_300_00,
  orders: 2,
  averageCheque: 650_00,
  cancellationRate: 0.25,
  fulfillment: { delivery: 7, pickup: 3 },
  revenueByDay: [
    { date: '2026-09-20', revenue: 400_00, orders: 1 },
    { date: '2026-09-21', revenue: 900_00, orders: 1 },
  ],
  topProducts: [
    { productName: 'Пепперони', quantity: 12, revenue: 756_00 },
    { productName: '4 сыра', quantity: 4, revenue: 260_00 },
  ],
  promocodes: [{ code: 'CHICAGO10', uses: 4, discount: 252_00 }],
};

vi.mock('@/entities/product/queries', () => ({ useBranches: () => branches() }));
vi.mock('@/features/admin/api', () => ({ adminApi: { analytics: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  branches.mockReturnValue({ data: [{ id: 'branch-1', name: 'На Гамзатова' }] });
  vi.mocked(adminApi.analytics).mockResolvedValue(SUMMARY as never);
});

describe('AdminAnalyticsPage — the headline figures', () => {
  it('leads with revenue and reports the rest beside it', async () => {
    renderWithProviders(<AdminAnalyticsPage />);

    await waitFor(() => expect(screen.getByText('Выручка по дням')).toBeInTheDocument());
    expect(screen.getAllByText(/1\s*300/).length).toBeGreaterThan(0);
    expect(screen.getByText('Средний чек').parentElement).toHaveTextContent('650');
    expect(screen.getByText('Доставлено заказов').parentElement).toHaveTextContent('2');
  });

  it('shows the cancellation rate as a percentage of finished orders', async () => {
    renderWithProviders(<AdminAnalyticsPage />);

    await waitFor(() => expect(screen.getByText('Отмены')).toBeInTheDocument());
    expect(screen.getByText('Отмены').parentElement).toHaveTextContent('25%');
    expect(screen.getByText('от завершённых заказов')).toBeInTheDocument();
  });
});

describe('AdminAnalyticsPage — filters', () => {
  it('asks for the last thirty days by default', async () => {
    renderWithProviders(<AdminAnalyticsPage />);

    await waitFor(() => expect(adminApi.analytics).toHaveBeenCalledWith(30, undefined));
  });

  it('changes the window', async () => {
    renderWithProviders(<AdminAnalyticsPage />);
    await waitFor(() => expect(adminApi.analytics).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '7 дней' }));

    await waitFor(() => expect(adminApi.analytics).toHaveBeenLastCalledWith(7, undefined));
  });

  it('narrows to one branch', async () => {
    renderWithProviders(<AdminAnalyticsPage />);
    await waitFor(() => expect(adminApi.analytics).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'На Гамзатова' }));

    await waitFor(() => expect(adminApi.analytics).toHaveBeenLastCalledWith(30, 'branch-1'));
  });
});

describe('AdminAnalyticsPage — what sells', () => {
  it('ranks products by revenue, with the quantity beside it', async () => {
    renderWithProviders(<AdminAnalyticsPage />);

    await waitFor(() => expect(screen.getByText('Пепперони')).toBeInTheDocument());
    expect(screen.getByText(/12 шт/)).toBeInTheDocument();
  });

  it('reports a promocode that cost money and one that did not', async () => {
    renderWithProviders(<AdminAnalyticsPage />);

    await waitFor(() => expect(screen.getByText('CHICAGO10')).toBeInTheDocument());

    vi.mocked(adminApi.analytics).mockResolvedValue({ ...SUMMARY, promocodes: [] } as never);
    fireEvent.click(screen.getByRole('button', { name: '7 дней' }));

    // A code issued and never redeemed is absent, which is the honest answer.
    await waitFor(() =>
      expect(screen.getByText('Ни один промокод не сработал за период')).toBeInTheDocument(),
    );
  });
});
