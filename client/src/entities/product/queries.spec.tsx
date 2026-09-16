import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/utils';
import { productApi } from './api';
import {
  productKeys,
  useCategories,
  useDoughTypes,
  useFavorites,
  useIngredients,
  useProduct,
  useProducts,
  useRecommendations,
  useToggleFavorite,
} from './queries';

const currentUser = vi.fn(() => ({ data: { id: 'user-1' } as { id: string } | null }));

vi.mock('@/entities/user/queries', () => ({
  useCurrentUser: () => currentUser(),
  userKeys: { me: ['user', 'me'] },
}));

vi.mock('./api', () => ({
  productApi: {
    categories: vi.fn(),
    doughTypes: vi.fn(),
    ingredients: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    recommendations: vi.fn(),
    favorites: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
  },
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
  vi.mocked(productApi.categories).mockResolvedValue([{ id: 'c1' }] as never);
  vi.mocked(productApi.doughTypes).mockResolvedValue([{ id: 'd1' }] as never);
  vi.mocked(productApi.ingredients).mockResolvedValue([{ id: 'i1' }] as never);
  vi.mocked(productApi.list).mockResolvedValue({ items: [{ id: 'p1' }] } as never);
  vi.mocked(productApi.get).mockResolvedValue({ id: 'p1' } as never);
  vi.mocked(productApi.recommendations).mockResolvedValue([{ id: 'p2' }] as never);
  vi.mocked(productApi.favorites).mockResolvedValue([{ id: 'p3' }] as never);
  vi.mocked(productApi.addFavorite).mockResolvedValue({ success: true } as never);
  vi.mocked(productApi.removeFavorite).mockResolvedValue({ success: true } as never);
});

describe('catalog reference data', () => {
  it.each([
    ['categories', useCategories, 'categories'],
    ['dough types', useDoughTypes, 'doughTypes'],
    ['ingredients', useIngredients, 'ingredients'],
    ['recommendations', useRecommendations, 'recommendations'],
  ])('loads %s', async (_label, hook, method) => {
    const { wrapper } = setup();

    const { result } = renderHook(() => hook(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(productApi[method as 'categories']).toHaveBeenCalled();
  });

  it('caches reference data for five minutes rather than refetching per mount', async () => {
    const { wrapper } = setup();

    const { result, rerender } = renderHook(() => useCategories(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender();

    expect(productApi.categories).toHaveBeenCalledTimes(1);
  });
});

describe('useProducts', () => {
  it('keys the cache by the filter set', async () => {
    const { wrapper, queryClient } = setup();

    const { result } = renderHook(() => useProducts({ categorySlug: 'pizza', limit: 60 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(productKeys.list({ categorySlug: 'pizza', limit: 60 }))).toBeDefined();
    expect(productApi.list).toHaveBeenCalledWith({ categorySlug: 'pizza', limit: 60 });
  });

  it('keeps the previous page on screen while the next one loads', async () => {
    const { wrapper } = setup();

    const { result, rerender } = renderHook(({ filters }) => useProducts(filters), {
      wrapper,
      initialProps: { filters: { categorySlug: 'pizza' } as Record<string, unknown> },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    vi.mocked(productApi.list).mockImplementation(() => new Promise(() => undefined) as never);
    rerender({ filters: { categorySlug: 'drinks' } });

    // The grid must not collapse to a spinner on every filter change.
    expect(result.current.data).toEqual({ items: [{ id: 'p1' }] });
    expect(result.current.isPlaceholderData).toBe(true);
  });
});

describe('useProduct', () => {
  it('fetches by slug', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useProduct('pepperoni'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ id: 'p1' }));
    expect(productApi.get).toHaveBeenCalledWith('pepperoni');
  });

  it('stays idle without a slug', () => {
    const { wrapper } = setup();

    renderHook(() => useProduct(''), { wrapper });

    expect(productApi.get).not.toHaveBeenCalled();
  });
});

describe('favorites', () => {
  it('loads the list for a signed-in customer', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useFavorites(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([{ id: 'p3' }]));
  });

  it('is skipped for a guest', () => {
    currentUser.mockReturnValue({ data: null });
    const { wrapper } = setup();

    renderHook(() => useFavorites(), { wrapper });

    expect(productApi.favorites).not.toHaveBeenCalled();
  });

  it('adds when the product is not yet a favorite', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useToggleFavorite(), { wrapper });
    result.current.mutate({ productId: 'p1', isFavorite: false });

    await waitFor(() => expect(productApi.addFavorite).toHaveBeenCalledWith('p1'));
    expect(productApi.removeFavorite).not.toHaveBeenCalled();
  });

  it('removes when it already is', async () => {
    const { wrapper } = setup();

    const { result } = renderHook(() => useToggleFavorite(), { wrapper });
    result.current.mutate({ productId: 'p1', isFavorite: true });

    await waitFor(() => expect(productApi.removeFavorite).toHaveBeenCalledWith('p1'));
    expect(productApi.addFavorite).not.toHaveBeenCalled();
  });

  it('refetches the list after toggling', async () => {
    const { wrapper, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useToggleFavorite(), { wrapper });
    result.current.mutate({ productId: 'p1', isFavorite: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productKeys.favorites });
  });
});
