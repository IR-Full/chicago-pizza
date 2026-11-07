import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import type { Promocode } from '@/shared/api/types';
import en from '@/shared/i18n/messages/en.json';
import { adminApi } from '@/features/admin/api';
import AdminPromocodesPage from './page';

const toast = { error: vi.fn(), success: vi.fn() };

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toast.error(...args),
    success: (...args: unknown[]) => toast.success(...args),
  },
}));
vi.mock('@/features/admin/api', () => ({
  adminApi: {
    listPromocodes: vi.fn(),
    createPromocode: vi.fn(),
    updatePromocode: vi.fn(),
  },
}));

const PROMO: Promocode = {
  id: 'promo-1',
  code: 'CHICAGO10',
  discountType: 'PERCENT',
  discountValue: 10,
  minOrderAmount: 0,
  maxUses: 100,
  usedCount: 3,
  isActive: true,
  expiresAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.listPromocodes).mockResolvedValue([PROMO]);
  vi.mocked(adminApi.updatePromocode).mockResolvedValue({ ...PROMO, isActive: false });
});

describe('promocode activation', () => {
  it('deactivates a used code and refreshes its status and usage from the server', async () => {
    vi.mocked(adminApi.listPromocodes)
      .mockResolvedValueOnce([PROMO])
      .mockResolvedValue([{ ...PROMO, isActive: false, usedCount: 4 }]);
    renderWithProviders(<AdminPromocodesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Отключить промокод CHICAGO10' }));

    await waitFor(() =>
      expect(adminApi.updatePromocode).toHaveBeenCalledWith('promo-1', { isActive: false }),
    );
    expect(await screen.findByRole('button', { name: 'Активировать промокод CHICAGO10' })).toBeEnabled();
    expect(screen.getByText('Неактивен')).toBeInTheDocument();
    expect(screen.getByText(/Использован: 4/)).toBeInTheDocument();
    expect(adminApi.listPromocodes).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('Промокод отключён');
  });

  it('reactivates a disabled code', async () => {
    vi.mocked(adminApi.listPromocodes)
      .mockResolvedValueOnce([{ ...PROMO, isActive: false }])
      .mockResolvedValue([PROMO]);
    vi.mocked(adminApi.updatePromocode).mockResolvedValue(PROMO);
    renderWithProviders(<AdminPromocodesPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Активировать промокод CHICAGO10' }));

    await waitFor(() => expect(adminApi.updatePromocode).toHaveBeenCalledWith('promo-1', { isActive: true }));
    expect(await screen.findByRole('button', { name: 'Отключить промокод CHICAGO10' })).toBeEnabled();
    expect(screen.getByText('Активен')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Промокод активирован');
  });

  it('blocks duplicate and competing changes while a status request is in flight', async () => {
    let finish!: (saved: Promocode) => void;
    vi.mocked(adminApi.updatePromocode).mockReturnValue(
      new Promise<Promocode>((resolve) => {
        finish = resolve;
      }),
    );
    vi.mocked(adminApi.listPromocodes).mockResolvedValue([
      PROMO,
      { ...PROMO, id: 'promo-2', code: 'NEXT10' },
    ]);
    renderWithProviders(<AdminPromocodesPage />);
    const action = await screen.findByRole('button', { name: 'Отключить промокод CHICAGO10' });
    fireEvent.click(action);

    await waitFor(() => expect(action).toBeDisabled());
    expect(action).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Отключить промокод NEXT10' })).toBeDisabled();
    fireEvent.click(action);
    expect(adminApi.updatePromocode).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ ...PROMO, isActive: false });
    });
  });

  it('shows the server refusal and retains the current status for another attempt', async () => {
    vi.mocked(adminApi.updatePromocode).mockRejectedValue(new ApiError('Недостаточно прав', 403));
    renderWithProviders(<AdminPromocodesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отключить промокод CHICAGO10' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Недостаточно прав'));
    expect(screen.getByRole('button', { name: 'Отключить промокод CHICAGO10' })).toBeEnabled();
    expect(screen.getByText('Активен')).toBeInTheDocument();
    expect(adminApi.listPromocodes).toHaveBeenCalledTimes(1);
  });

  it('retains the confirmed status if the list refresh fails after saving', async () => {
    vi.mocked(adminApi.listPromocodes)
      .mockResolvedValueOnce([PROMO])
      .mockRejectedValue(new ApiError('Список временно недоступен', 503));
    renderWithProviders(<AdminPromocodesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отключить промокод CHICAGO10' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Список временно недоступен');
    expect(screen.getByRole('button', { name: 'Активировать промокод CHICAGO10' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled();
    expect(screen.getByText('Неактивен')).toBeInTheDocument();
  });

  it('keeps expiry and usage-limit restrictions visible after reactivation', async () => {
    const expired = { ...PROMO, isActive: false, usedCount: 100, expiresAt: '2000-01-01T00:00:00.000Z' };
    vi.mocked(adminApi.listPromocodes)
      .mockResolvedValueOnce([expired])
      .mockResolvedValue([{ ...expired, isActive: true }]);
    vi.mocked(adminApi.updatePromocode).mockResolvedValue({ ...expired, isActive: true });
    renderWithProviders(<AdminPromocodesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Активировать промокод CHICAGO10' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.getByText('Срок истёк')).toBeInTheDocument();
    expect(screen.getByText('Лимит исчерпан')).toBeInTheDocument();
    expect(screen.queryByText('Активен')).not.toBeInTheDocument();
  });

  it('uses the English action and error fallback', async () => {
    vi.mocked(adminApi.updatePromocode).mockRejectedValue(new Error('connection lost'));
    renderWithProviders(<AdminPromocodesPage />, { locale: 'en', messages: en });
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate promo code CHICAGO10' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update the promo code status'));
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
