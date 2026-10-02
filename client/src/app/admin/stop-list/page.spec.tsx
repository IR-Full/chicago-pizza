import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import { adminApi } from '@/features/admin/api';
import AdminStopListPage from './page';

const toast = { error: vi.fn(), success: vi.fn() };
const products = vi.fn(() => ({
  data: { items: ITEMS } as Record<string, unknown> | undefined,
  isLoading: false,
}));

const AVAILABLE = {
  id: 'p1',
  name: 'Пепперони',
  slug: 'pepperoni',
  isAvailable: true,
  stoppedUntil: null,
};
/**
 * Relative to now, not written down: the client re-derives availability from
 * `stoppedUntil`, so a fixed timestamp would quietly age into an on-sale row
 * and take these assertions with it.
 */
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const clockOf = (iso: string) =>
  new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const SOLD_OUT = {
  id: 'p2',
  name: '4 сыра',
  slug: '4-cheese',
  isAvailable: false,
  stoppedUntil: inHours(3),
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
    expect(screen.getByText(`Снято до ${clockOf(SOLD_OUT.stoppedUntil)}`)).toBeInTheDocument();
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

  /**
   * A stop ends on its own clock — nothing runs to switch the item back on,
   * and the catalog answer is cached for five minutes. The row the payload
   * still calls sold out has to read as on sale the moment the time passes,
   * or "back at 19:00" is a promise the screen breaks for five minutes.
   */
  it('counts an expired stop as back on sale, whatever the payload says', () => {
    products.mockReturnValue({
      data: { items: [{ ...SOLD_OUT, isAvailable: false, stoppedUntil: inHours(-1) }] },
      isLoading: false,
    });
    renderWithProviders(<AdminStopListPage />);

    expect(screen.getByText('Все позиции в продаже')).toBeInTheDocument();
    expect(within(rowOf('4 сыра')).getByRole('button', { name: '1 ч' })).toBeInTheDocument();
    expect(
      within(rowOf('4 сыра')).queryByRole('button', { name: 'Вернуть в продажу' }),
    ).not.toBeInTheDocument();
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
