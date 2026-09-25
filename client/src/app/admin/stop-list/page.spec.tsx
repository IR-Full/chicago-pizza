import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import { adminApi } from '@/features/admin/api';
import AdminStopListPage from './page';

const toast = { error: vi.fn(), success: vi.fn() };
const products = vi.fn(() => ({ data: { items: ITEMS } as Record<string, unknown> | undefined, isLoading: false }));

const AVAILABLE = {
  id: 'p1',
  name: 'Пепперони',
  slug: 'pepperoni',
  isAvailable: true,
  stoppedUntil: null,
};
const SOLD_OUT = {
  id: 'p2',
  name: '4 сыра',
  slug: '4-cheese',
  isAvailable: false,
  stoppedUntil: '2026-09-24T20:00:00.000Z',
};
const ITEMS = [AVAILABLE, SOLD_OUT];

vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toast.error(...a), success: (...a: unknown[]) => toast.success(...a) },
}));
vi.mock('@/entities/product/queries', () => ({ useProducts: () => products() }));
vi.mock('@/features/admin/api', () => ({ adminApi: { stopProduct: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  products.mockReturnValue({ data: { items: ITEMS }, isLoading: false });
  vi.mocked(adminApi.stopProduct).mockResolvedValue(AVAILABLE as never);
});

const rowOf = (name: string) => screen.getByText(name).closest('div[class*="rounded-card"]') as HTMLElement;

describe('AdminStopListPage', () => {
  it('separates what is off the menu from what is on it', () => {
    renderWithProviders(<AdminStopListPage />);

    expect(screen.getByText('Стоп-лист')).toBeInTheDocument();
    expect(screen.getByText('Снято до 23:00')).toBeInTheDocument();
  });

  /**
   * Durations, not clock times: staff think in "for an hour", and a time they
   * have to work out at the end of a shift is one they will get wrong.
   */
  it('pauses an item for the chosen duration', async () => {
    renderWithProviders(<AdminStopListPage />);

    fireEvent.click(within(rowOf('Пепперони')).getByRole('button', { name: '1 ч' }));

    await waitFor(() => expect(adminApi.stopProduct).toHaveBeenCalledWith('p1', 60));
  });

  it('puts a sold-out item back with zero minutes', async () => {
    renderWithProviders(<AdminStopListPage />);

    fireEvent.click(within(rowOf('4 сыра')).getByRole('button', { name: 'Вернуть в продажу' }));

    await waitFor(() => expect(adminApi.stopProduct).toHaveBeenCalledWith('p2', 0));
  });

  it('offers no pause buttons for something already off', () => {
    renderWithProviders(<AdminStopListPage />);

    expect(within(rowOf('4 сыра')).queryByRole('button', { name: '1 ч' })).not.toBeInTheDocument();
  });

  it('says so when nothing is stopped', () => {
    products.mockReturnValue({ data: { items: [AVAILABLE] }, isLoading: false });
    renderWithProviders(<AdminStopListPage />);

    expect(screen.getByText('Все позиции в продаже')).toBeInTheDocument();
  });

  it('surfaces the server’s refusal', async () => {
    vi.mocked(adminApi.stopProduct).mockRejectedValue(new ApiError('Товар не найден', 404));
    renderWithProviders(<AdminStopListPage />);

    fireEvent.click(within(rowOf('Пепперони')).getByRole('button', { name: '1 ч' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Товар не найден'));
  });
});
