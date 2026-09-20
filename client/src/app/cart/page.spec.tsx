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

// Delivery is priced by the server and comes back on the cart itself.
const CART = {
  lines: [line()],
  subtotal: 63000,
  itemCount: 1,
  deliveryFee: 15000,
  freeDeliveryThreshold: 100000,
  total: 78000,
  removed: [],
};

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
    cart.mockReturnValue({ data: { ...CART, lines: [], subtotal: 0, itemCount: 0, total: 0 }, isLoading: false });
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
      data: {
        ...CART,
        lines: [line(), line({ lineId: 'l2', productName: 'Барбекю' })],
        subtotal: 126000,
        itemCount: 2,
      },
      isLoading: false,
    });
    renderWithProviders(<CartPage />);

    expect(screen.getByText('Пепперони')).toBeInTheDocument();
    expect(screen.getByText('Барбекю')).toBeInTheDocument();
  });

  it('shows the delivery fee and total the server calculated', () => {
    renderWithProviders(<CartPage />);

    expect(screen.getByText(/150/)).toBeInTheDocument();
    // 630 ₽ of pizza + 150 ₽ delivery — both numbers come from the API.
    expect(screen.getByText(/780/)).toBeInTheDocument();
  });

  it('delivers free when the server says the fee is zero', () => {
    cart.mockReturnValue({
      data: { ...CART, subtotal: 100000, deliveryFee: 0, total: 100000 },
      isLoading: false,
    });
    renderWithProviders(<CartPage />);

    expect(screen.getByText('Бесплатно')).toBeInTheDocument();
  });

  it('never recomputes the tariff itself', () => {
    // A hardcoded threshold on the client would disagree with the server the
    // day the tariff changes; the page only renders what it was given.
    cart.mockReturnValue({
      data: { ...CART, subtotal: 20000, deliveryFee: 8800, total: 99900 },
      isLoading: false,
    });
    renderWithProviders(<CartPage />);

    // 88 ₽ delivery and a 999 ₽ total that no local formula could produce.
    expect(screen.getByText('Доставка').parentElement).toHaveTextContent('88');
    expect(screen.getByText(/999/)).toBeInTheDocument();
  });

  it('explains lines the server dropped because the product went off sale', () => {
    cart.mockReturnValue({
      data: { ...CART, removed: [{ productName: 'Барбекю', reason: 'Товар снят с продажи' }] },
      isLoading: false,
    });
    renderWithProviders(<CartPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Барбекю');
    expect(screen.getByRole('status')).toHaveTextContent('Товар снят с продажи');
  });

  it('shows no notice when nothing was dropped', () => {
    renderWithProviders(<CartPage />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
