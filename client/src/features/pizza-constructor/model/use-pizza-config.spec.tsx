import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/utils';
import { productApi } from '@/entities/product/api';
import { usePizzaConfig } from './use-pizza-config';

vi.mock('@/entities/product/api', () => ({ productApi: { price: vi.fn() } }));

const PIZZA = {
  id: 'p1',
  name: 'Пепперони',
  type: 'PIZZA',
  sizes: [
    { id: 's30', sizeCm: 30, label: '30 см', price: 44000 },
    { id: 's45', sizeCm: 45, label: '45 см', price: 63000 },
  ],
  ingredients: [],
};

const DRINK = { id: 'd1', name: 'Кола', type: 'DRINK', sizes: [], ingredients: [] };

const DOUGHS = [
  { id: 'dough-thin', name: 'Тонкое', priceModifier: 0 },
  { id: 'dough-cheesy', name: 'Сырное', priceModifier: 15000 },
];

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

const renderConfig = (product: unknown = PIZZA, doughTypes: unknown[] = DOUGHS) => {
  const { wrapper } = setup();
  return renderHook(
    ({ p, d }: { p: unknown; d: unknown[] }) => usePizzaConfig({ product: p as never, doughTypes: d as never }),
    { wrapper, initialProps: { p: product, d: doughTypes } },
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productApi.price).mockResolvedValue({ unitPrice: 44000, totalPrice: 44000 } as never);
});

describe('usePizzaConfig — defaults', () => {
  it('starts on the smallest size and the first dough', () => {
    const { result } = renderConfig();

    expect(result.current.sizeCm).toBe(30);
    expect(result.current.doughTypeId).toBe('dough-thin');
    expect(result.current.quantity).toBe(1);
  });

  it('picks a dough as soon as the list arrives', async () => {
    const { result, rerender } = renderConfig(PIZZA, []);

    expect(result.current.doughTypeId).toBeUndefined();
    rerender({ p: PIZZA, d: DOUGHS });

    await waitFor(() => expect(result.current.doughTypeId).toBe('dough-thin'));
  });

  it('marks a non-pizza product as simple', () => {
    const { result } = renderConfig(DRINK, DOUGHS);

    expect(result.current.isPizza).toBe(false);
  });
});

describe('usePizzaConfig — the configuration it builds', () => {
  it('sends only the product id for a simple product', async () => {
    const { result } = renderConfig(DRINK, DOUGHS);

    expect(result.current.config).toEqual({ productId: 'd1' });
    await waitFor(() => expect(productApi.price).toHaveBeenCalledWith({ productId: 'd1' }, 1));
  });

  it('carries size, dough and halves for a pizza', () => {
    const { result } = renderConfig();

    act(() => {
      result.current.setSizeCm(45);
      result.current.setDoughTypeId('dough-cheesy');
      result.current.setSecondHalfProductId('p2');
    });

    expect(result.current.config).toMatchObject({
      productId: 'p1',
      sizeCm: 45,
      doughTypeId: 'dough-cheesy',
      secondHalfProductId: 'p2',
    });
  });

  it('omits empty ingredient lists rather than sending empty arrays', () => {
    const { result } = renderConfig();

    expect(result.current.config.addedIngredientIds).toBeUndefined();
    expect(result.current.config.removedIngredientIds).toBeUndefined();
  });

  it('toggles an added ingredient on and off', () => {
    const { result } = renderConfig();

    act(() => result.current.toggleAddedIngredient('bacon'));
    expect(result.current.config.addedIngredientIds).toEqual(['bacon']);

    act(() => result.current.toggleAddedIngredient('bacon'));
    expect(result.current.config.addedIngredientIds).toBeUndefined();
  });

  it('accumulates several added ingredients', () => {
    const { result } = renderConfig();

    act(() => result.current.toggleAddedIngredient('bacon'));
    act(() => result.current.toggleAddedIngredient('cheese'));

    expect(result.current.addedIngredientIds).toEqual(['bacon', 'cheese']);
  });

  it('toggles a removed recipe ingredient', () => {
    const { result } = renderConfig();

    act(() => result.current.toggleRemovedIngredient('onion'));
    expect(result.current.config.removedIngredientIds).toEqual(['onion']);

    act(() => result.current.toggleRemovedIngredient('onion'));
    expect(result.current.removedIngredientIds).toEqual([]);
  });
});

describe('usePizzaConfig — pricing', () => {
  it('asks the server for the price and never computes it locally', async () => {
    const { result } = renderConfig();

    await waitFor(() => expect(result.current.price).toEqual({ unitPrice: 44000, totalPrice: 44000 }));
    expect(productApi.price).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1', sizeCm: 30 }), 1);
  });

  it('re-prices when the size changes', async () => {
    const { result } = renderConfig();
    await waitFor(() => expect(productApi.price).toHaveBeenCalledTimes(1));

    act(() => result.current.setSizeCm(45));

    await waitFor(() =>
      expect(productApi.price).toHaveBeenLastCalledWith(expect.objectContaining({ sizeCm: 45 }), 1),
    );
  });

  it('re-prices when the quantity changes', async () => {
    const { result } = renderConfig();
    await waitFor(() => expect(productApi.price).toHaveBeenCalledTimes(1));

    act(() => result.current.setQuantity(3));

    await waitFor(() => expect(productApi.price).toHaveBeenLastCalledWith(expect.anything(), 3));
  });

  it('does not price a pizza that has no size yet', () => {
    renderConfig({ ...PIZZA, sizes: [] }, DOUGHS);

    expect(productApi.price).not.toHaveBeenCalled();
  });

  it('exposes a pricing failure instead of showing a stale number', async () => {
    vi.mocked(productApi.price).mockRejectedValue(new Error('Size 45 cm is not available'));
    const { result } = renderConfig();

    await waitFor(() => expect(result.current.priceError).toBeTruthy());
    expect(result.current.price).toBeUndefined();
  });
});

describe('usePizzaConfig — reuse across products', () => {
  it('resets the configuration when the dialog opens a different product', async () => {
    const { result, rerender } = renderConfig();

    act(() => {
      result.current.setSizeCm(45);
      result.current.setSecondHalfProductId('p2');
      result.current.toggleAddedIngredient('bacon');
      result.current.setQuantity(4);
    });

    rerender({ p: { ...PIZZA, id: 'p9', sizes: [{ id: 's60', sizeCm: 60, label: '60 см', price: 86000 }] }, d: DOUGHS });

    await waitFor(() => expect(result.current.sizeCm).toBe(60));
    expect(result.current.secondHalfProductId).toBeUndefined();
    expect(result.current.addedIngredientIds).toEqual([]);
    expect(result.current.quantity).toBe(1);
  });
});
