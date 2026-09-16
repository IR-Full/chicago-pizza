import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cartKeys } from '@/entities/cart/queries';
import { createTestQueryClient } from '@/test/utils';
import { orderApi } from './api';
import { orderKeys, useCheckout, useOrder, useOrders, useRepeatOrder, useSubmitReview } from './queries';

const currentUser = vi.fn(() => ({ data: { id: 'user-1' } as { id: string } | null }));

vi.mock('@/entities/user/queries', () => ({
  useCurrentUser: () => currentUser(),
  userKeys: { me: ['user', 'me'], loyalty: ['user', 'loyalty'] },
}));

vi.mock('./api', () => ({
  orderApi: { checkout: vi.fn(), list: vi.fn(), get: vi.fn(), repeat: vi.fn(), review: vi.fn() },
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
  vi.mocked(orderApi.list).mockResolvedValue({ items: [{ id: 'order-1' }] } as never);
  vi.mocked(orderApi.get).mockResolvedValue({ id: 'order-1' } as never);
  vi.mocked(orderApi.checkout).mockResolvedValue({ id: 'order-1' } as never);
  vi.mocked(orderApi.repeat).mockResolvedValue({ lines: [{ lineId: 'l1' }], subtotal: 63000, itemCount: 1 } as never);
  vi.mocked(orderApi.review).mockResolvedValue({ rating: 5, comment: null } as never);
});

describe('useOrders', () => {
  it('loads the history of a signed-in customer', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useOrders(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ items: [{ id: 'order-1' }] }));
    expect(orderApi.list).toHaveBeenCalledWith(1);
  });

  it('keys each page separately', async () => {
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useOrders(3), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(orderKeys.list(3))).toBeDefined();
    expect(orderApi.list).toHaveBeenCalledWith(3);
  });

  it('does not ask for a guest’s history', () => {
    currentUser.mockReturnValue({ data: null });
    const { wrapper } = setup();

    renderHook(() => useOrders(), { wrapper });

    expect(orderApi.list).not.toHaveBeenCalled();
  });
});

describe('useOrder', () => {
  it('fetches one order by id', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useOrder('order-1'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ id: 'order-1' }));
  });

  it('stays idle without an id', () => {
    const { wrapper } = setup();

    renderHook(() => useOrder(''), { wrapper });

    expect(orderApi.get).not.toHaveBeenCalled();
  });
});

describe('useCheckout', () => {
  it('refreshes the cart, the history and the loyalty balance', async () => {
    const { wrapper, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCheckout(), { wrapper });
    result.current.mutate({ addressId: 'addr-1' } as never);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Checkout empties the cart and may have spent points.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: cartKeys.cart });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user', 'loyalty'] });
  });

  it('leaves the caches alone when checkout fails', async () => {
    vi.mocked(orderApi.checkout).mockRejectedValue(new Error('Корзина пуста'));
    const { wrapper, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCheckout(), { wrapper });
    result.current.mutate({ addressId: 'addr-1' } as never);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useRepeatOrder', () => {
  it('puts the returned cart straight into the cache', async () => {
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useRepeatOrder(), { wrapper });
    result.current.mutate('order-1');

    await waitFor(() =>
      expect(queryClient.getQueryData(cartKeys.cart)).toEqual({
        lines: [{ lineId: 'l1' }],
        subtotal: 63000,
        itemCount: 1,
      }),
    );
  });
});

describe('useSubmitReview', () => {
  it('refreshes that order and the list it appears in', async () => {
    const { wrapper, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useSubmitReview(), { wrapper });
    result.current.mutate({ id: 'order-1', rating: 5, comment: 'Вкусно' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(orderApi.review).toHaveBeenCalledWith('order-1', 5, 'Вкусно');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: orderKeys.detail('order-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'list'] });
  });
});
