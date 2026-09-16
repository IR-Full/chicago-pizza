import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import CartPage from './page';

const user = vi.fn(() => ({ data: { id: 'user-1' } as Record<string, unknown> | null, isLoading: false }));
const cart = vi.fn(() => ({ data: CART as Record<string, unknown> | undefined, isLoading: false }));
const updateItem = { mutateAsync: vi.fn(), isPending: false };
const removeItem = { mutateAsync: vi.fn(), isPending: false };
const toast = { error: vi.fn(), success: vi.fn() };

const line = (overrides: Record<string, unknown> = {}) => ({
  lineId: 'l1',
  productId: 'p1',
  productName: 'Пепперони',
  sizeLabel: '45 см',
  doughTypeName: 'Тонкое',
  addedIngredients: [],
  removedIngredients: [],
  unitPrice: 63000,
  quantity: 1,
  totalPrice: 63000,
  imageUrl: null,
  ...overrides,
});

const CART = { lines: [line()], subtotal: 63000, itemCount: 1 };

vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toast.error(...a), success: (...a: unknown[]) => toast.success(...a) },
}));
vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => user() }));
vi.mock('@/entities/cart/queries', () => ({
  useCart: () => cart(),
  useUpdateCartItem: () => updateItem,
  useRemoveCartItem: () => removeItem,
}));

beforeEach(() => {
  vi.clearAllMocks();
  user.mockReturnValue({ data: { id: 'user-1' }, isLoading: false });
  cart.mockReturnValue({ data: CART, isLoading: false });
  updateItem.mutateAsync.mockResolvedValue(CART);
  removeItem.mutateAsync.mockResolvedValue(CART);
});

describe('CartPage — states', () => {
  it('shows skeletons while the session and cart load', () => {
    user.mockReturnValue({ data: null, isLoading: true });
    const { container } = renderWithProviders(<CartPage />);

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('asks a guest to sign in', () => {
    user.mockReturnValue({ data: null, isLoading: false });
    renderWithProviders(<CartPage />);

    expect(screen.getByRole('link', { name: 'Войдите, чтобы продолжить' })).toHaveAttribute(
      'href',
      '/login?redirect=/cart',
    );
  });

  it('invites an empty cart back to the menu', () => {
    cart.mockReturnValue({ data: { lines: [], subtotal: 0, itemCount: 0 }, isLoading: false });
    renderWithProviders(<CartPage />);

    expect(screen.getByRole('heading', { name: 'Корзина пуста' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Перейти в меню' })).toHaveAttribute('href', '/menu');
  });

  it('treats an unavailable cart as empty rather than crashing', () => {
    cart.mockReturnValue({ data: undefined, isLoading: false });
    renderWithProviders(<CartPage />);

    expect(screen.getByRole('heading', { name: 'Корзина пуста' })).toBeInTheDocument();
  });
});

describe('CartPage — contents and totals', () => {
  it('lists every line', () => {
    cart.mockReturnValue({
      data: { lines: [line(), line({ lineId: 'l2', productName: 'Барбекю' })], subtotal: 126000, itemCount: 2 },
      isLoading: false,
    });
    renderWithProviders(<CartPage />);

    expect(screen.getByText('Пепперони')).toBeInTheDocument();
    expect(screen.getByText('Барбекю')).toBeInTheDocument();
  });

  it('charges delivery below the free threshold and adds it to the total', () => {
    renderWithProviders(<CartPage />);

    expect(screen.getByText(/150/)).toBeInTheDocument();
    // 630 ₽ of pizza + 150 ₽ delivery.
    expect(screen.getByText(/780/)).toBeInTheDocument();
  });

  it('delivers free from a thousand roubles', () => {
    cart.mockReturnValue({ data: { lines: [line()], subtotal: 100000, itemCount: 1 }, isLoading: false });
    renderWithProviders(<CartPage />);

    expect(screen.getByText('Бесплатно')).toBeInTheDocument();
  });

  it('leads to checkout', () => {
    renderWithProviders(<CartPage />);

    expect(screen.getByRole('link', { name: 'Оформить заказ' })).toHaveAttribute('href', '/checkout');
  });
});

describe('CartPage — editing', () => {
  it('changes a quantity through the API', async () => {
    renderWithProviders(<CartPage />);

    fireEvent.click(screen.getByRole('button', { name: '+' }));

    await waitFor(() => expect(updateItem.mutateAsync).toHaveBeenCalledWith({ lineId: 'l1', quantity: 2 }));
  });

  it('removes a line through the API', async () => {
    renderWithProviders(<CartPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Корзина' }));

    await waitFor(() => expect(removeItem.mutateAsync).toHaveBeenCalledWith('l1'));
  });

  it('reports a refused update', async () => {
    updateItem.mutateAsync.mockRejectedValue(new ApiError('Cart line not found', 404));
    renderWithProviders(<CartPage />);

    fireEvent.click(screen.getByRole('button', { name: '+' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cart line not found'));
  });

  it('reports a refused removal', async () => {
    removeItem.mutateAsync.mockRejectedValue(new Error('offline'));
    renderWithProviders(<CartPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Корзина' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Не удалось удалить товар'));
  });
});
