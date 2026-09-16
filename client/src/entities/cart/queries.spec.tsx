import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/utils';
import { cartApi } from './api';
import {
  cartKeys,
  useAddToCart,
  useCart,
  useCheckPromocode,
  useClearCart,
  useRemoveCartItem,
  useUpdateCartItem,
} from './queries';

const currentUser = vi.fn(() => ({ data: { id: 'user-1' } }));

vi.mock('@/entities/user/queries', () => ({
  useCurrentUser: () => currentUser(),
  userKeys: { me: ['user', 'me'] },
}));

vi.mock('./api', () => ({
  cartApi: {
    get: vi.fn(),
    addItem: vi.fn(),
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    checkPromocode: vi.fn(),
  },
}));

const CART = { lines: [{ lineId: 'l1' }], subtotal: 63000, itemCount: 1 };

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
  vi.mocked(cartApi.get).mockResolvedValue(CART as never);
  vi.mocked(cartApi.addItem).mockResolvedValue(CART as never);
  vi.mocked(cartApi.updateItem).mockResolvedValue(CART as never);
  vi.mocked(cartApi.removeItem).mockResolvedValue(CART as never);
  vi.mocked(cartApi.clear).mockResolvedValue({ lines: [], subtotal: 0, itemCount: 0 } as never);
});

describe('useCart', () => {
  it('fetches the cart for a signed-in customer', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(CART));
    expect(cartApi.get).toHaveBeenCalledTimes(1);
  });

  it('shows an empty cart to a guest without calling the API', async () => {
    currentUser.mockReturnValue({ data: null } as never);
    const { wrapper } = setup();

    const { result } = renderHook(() => useCart(), { wrapper });

    expect(result.current.data).toEqual({ lines: [], subtotal: 0, itemCount: 0 });
    expect(cartApi.get).not.toHaveBeenCalled();
  });

  it('renders the placeholder while the first fetch is in flight', () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useCart(), { wrapper });

    // The header badge must not flash "undefined" on first paint.
    expect(result.current.data).toEqual({ lines: [], subtotal: 0, itemCount: 0 });
  });
});

describe('cart mutations', () => {
  it('writes the server cart straight into the cache after adding', async () => {
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useAddToCart(), { wrapper });
    result.current.mutate({ config: { productId: 'p1' } as never, quantity: 2 });

    await waitFor(() => expect(queryClient.getQueryData(cartKeys.cart)).toEqual(CART));
    expect(cartApi.addItem).toHaveBeenCalledWith({ productId: 'p1' }, 2);
  });

  it('updates a line by id and quantity', async () => {
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useUpdateCartItem(), { wrapper });
    result.current.mutate({ lineId: 'l1', quantity: 3 });

    await waitFor(() => expect(queryClient.getQueryData(cartKeys.cart)).toEqual(CART));
    expect(cartApi.updateItem).toHaveBeenCalledWith('l1', 3);
  });

  it('removes a line', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useRemoveCartItem(), { wrapper });
    result.current.mutate('l1');

    await waitFor(() => expect(cartApi.removeItem).toHaveBeenCalledWith('l1'));
  });

  it('empties the cache when the cart is cleared', async () => {
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useClearCart(), { wrapper });
    result.current.mutate();

    await waitFor(() =>
      expect(queryClient.getQueryData(cartKeys.cart)).toEqual({ lines: [], subtotal: 0, itemCount: 0 }),
    );
  });

  it('leaves the cache untouched when a mutation fails', async () => {
    vi.mocked(cartApi.addItem).mockRejectedValue(new Error('Cart is full'));
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useAddToCart(), { wrapper });
    result.current.mutate({ config: { productId: 'p1' } as never, quantity: 1 });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData(cartKeys.cart)).toBeUndefined();
  });
});

describe('useCheckPromocode', () => {
  it('validates a code without writing to the cart cache', async () => {
    vi.mocked(cartApi.checkPromocode).mockResolvedValue({ code: 'CHICAGO10', discount: 6300 } as never);
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useCheckPromocode(), { wrapper });
    result.current.mutate('CHICAGO10');

    await waitFor(() => expect(result.current.data).toEqual({ code: 'CHICAGO10', discount: 6300 }));
    expect(queryClient.getQueryData(cartKeys.cart)).toBeUndefined();
  });

  it('surfaces a rejected code as an error', async () => {
    vi.mocked(cartApi.checkPromocode).mockRejectedValue(new Error('Промокод истёк'));
    const { wrapper } = setup();

    const { result } = renderHook(() => useCheckPromocode(), { wrapper });
    result.current.mutate('OLD');

    await waitFor(() => expect(result.current.error).toMatchObject({ message: 'Промокод истёк' }));
  });
});
