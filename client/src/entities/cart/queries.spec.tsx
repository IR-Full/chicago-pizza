import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/utils';
import { cartApi } from './api';
import { guestCart } from './guest-cart';
import {
  cartKeys,
  useAddToCart,
  useCart,
  useCheckPromocode,
  useClearCart,
  useMergeGuestCart,
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
    preview: vi.fn(),
    merge: vi.fn(),
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
  vi.mocked(cartApi.preview).mockResolvedValue(CART as never);
  vi.mocked(cartApi.merge).mockResolvedValue(CART as never);
  window.localStorage.clear();
});

describe('useCart', () => {
  it('fetches the cart for a signed-in customer', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(CART));
    expect(cartApi.get).toHaveBeenCalledTimes(1);
  });

  it('shows a guest the placeholder until their basket is priced', async () => {
    currentUser.mockReturnValue({ data: null } as never);
    const { wrapper } = setup();

    const { result } = renderHook(() => useCart(), { wrapper });

    // Nothing user-scoped is fetched for a guest; the browser cart is priced
    // instead, and until that lands the placeholder quotes no delivery fee.
    expect(result.current.data).toEqual({
      lines: [],
      subtotal: 0,
      itemCount: 0,
      deliveryFee: 0,
      freeDeliveryThreshold: 0,
      total: 0,
      removed: [],
    });
    expect(cartApi.get).not.toHaveBeenCalled();
  });

  it('renders the placeholder while the first fetch is in flight', () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useCart(), { wrapper });

    // The header badge must not flash "undefined" on first paint.
    expect(result.current.data).toMatchObject({ lines: [], subtotal: 0, itemCount: 0, total: 0 });
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

/**
 * A visitor with no account still has a basket. It lives in their browser,
 * but it is priced by the server — a total the client invented would change
 * at the door.
 */
describe('useCart — a guest', () => {
  beforeEach(() => {
    currentUser.mockReturnValue({ data: null } as never);
    window.localStorage.clear();
  });

  it('prices the browser cart instead of asking for the account one', async () => {
    guestCart.add({ productId: 'p1', sizeCm: 45 }, 2);
    vi.mocked(cartApi.preview).mockResolvedValue(CART as never);

    const { wrapper } = setup();
    const { result } = renderHook(() => useCart(), { wrapper });

    await waitFor(() => expect(cartApi.preview).toHaveBeenCalled());
    expect(cartApi.get).not.toHaveBeenCalled();
    expect(vi.mocked(cartApi.preview).mock.calls[0][0]).toEqual([
      { lineId: expect.any(String), config: { productId: 'p1', sizeCm: 45 }, quantity: 2 },
    ]);
    await waitFor(() => expect(result.current.data).toEqual(CART));
  });

  it('adds to the browser cart, then has the server value it', async () => {
    vi.mocked(cartApi.preview).mockResolvedValue(CART as never);

    const { wrapper } = setup();
    const { result } = renderHook(() => useAddToCart(), { wrapper });
    result.current.mutate({ config: { productId: 'p1', sizeCm: 45 }, quantity: 1 });

    await waitFor(() => expect(cartApi.preview).toHaveBeenCalled());
    expect(cartApi.addItem).not.toHaveBeenCalled();
    expect(guestCart.lines()).toHaveLength(1);
  });
});

describe('useMergeGuestCart', () => {
  beforeEach(() => {
    currentUser.mockReturnValue({ data: { id: 'user-1' } });
    window.localStorage.clear();
  });

  it('hands the browser cart to the account and then forgets it', async () => {
    guestCart.add({ productId: 'p1', sizeCm: 45 }, 1);
    vi.mocked(cartApi.merge).mockResolvedValue(CART as never);

    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeGuestCart(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(cartApi.merge).toHaveBeenCalled());
    expect(guestCart.lines()).toEqual([]);
  });

  it('keeps the basket when the merge fails', async () => {
    guestCart.add({ productId: 'p1', sizeCm: 45 }, 1);
    vi.mocked(cartApi.merge).mockRejectedValue(new Error('offline'));

    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeGuestCart(), { wrapper });
    result.current.mutate();

    // Throwing the customer's basket away on a network blip is the one
    // outcome worse than not merging it.
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(guestCart.lines()).toHaveLength(1);
  });

  it('does not call the API for an empty basket', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeGuestCart(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(cartApi.merge).not.toHaveBeenCalled();
  });
});
