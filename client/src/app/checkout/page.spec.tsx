import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import CheckoutPage from './page';

const router = { push: vi.fn() };
const toast = { success: vi.fn(), error: vi.fn() };

const user = vi.fn(() => ({ data: { id: 'user-1' } as Record<string, unknown> | null, isLoading: false }));
const cart = vi.fn(() => ({ data: CART as Record<string, unknown> | undefined, isLoading: false }));
const addresses = vi.fn(() => ({ data: ADDRESSES as Record<string, unknown>[] }));
const loyalty = vi.fn(() => ({ data: { points: 0 } as Record<string, unknown> | undefined }));
const checkPromocode = { mutateAsync: vi.fn(), isPending: false };
const checkout = { mutateAsync: vi.fn(), isPending: false };

const CART = {
  lines: [{ lineId: 'l1', productName: 'Пепперони' }],
  subtotal: 63000,
  itemCount: 1,
  // Delivery is priced server-side and travels on the cart itself.
  deliveryFee: 15000,
  freeDeliveryThreshold: 100000,
  total: 78000,
  removed: [],
};
const ADDRESSES = [
  { id: 'addr-1', title: 'Дом', city: 'Махачкала', street: 'Ленина', house: '1', apartment: '5', isDefault: false },
  { id: 'addr-2', title: 'Работа', city: 'Махачкала', street: 'Гамзатова', house: '45', isDefault: true },
];

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a) },
}));
vi.mock('@/entities/user/queries', () => ({
  useCurrentUser: () => user(),
  useAddresses: () => addresses(),
  useLoyalty: () => loyalty(),
  useCreateAddress: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/entities/cart/queries', () => ({ useCart: () => cart(), useCheckPromocode: () => checkPromocode }));
vi.mock('@/entities/order/queries', () => ({ useCheckout: () => checkout }));

beforeEach(() => {
  vi.clearAllMocks();
  user.mockReturnValue({ data: { id: 'user-1' }, isLoading: false });
  cart.mockReturnValue({ data: CART, isLoading: false });
  addresses.mockReturnValue({ data: ADDRESSES });
  loyalty.mockReturnValue({ data: { points: 0 } });
  checkPromocode.mutateAsync.mockResolvedValue({ promocodeId: 'promo-1', code: 'CHICAGO10', discount: 6300 });
  checkout.mutateAsync.mockResolvedValue({ id: 'order-1' });
});

const placeOrder = () => fireEvent.click(screen.getByRole('button', { name: 'Подтвердить заказ' }));

describe('CheckoutPage — gates', () => {
  it('shows skeletons while loading', () => {
    cart.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderWithProviders(<CheckoutPage />);

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('asks a guest to sign in and come back', () => {
    user.mockReturnValue({ data: null, isLoading: false });
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByRole('link', { name: 'Войдите, чтобы продолжить' })).toHaveAttribute(
      'href',
      '/login?redirect=/checkout',
    );
  });

  it('sends an empty cart back to the menu', () => {
    cart.mockReturnValue({ data: { ...CART, lines: [], subtotal: 0, itemCount: 0, total: 0 }, isLoading: false });
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByRole('link', { name: 'Перейти в меню' })).toHaveAttribute('href', '/menu');
  });
});

describe('CheckoutPage — address', () => {
  it('preselects the default address so the common case is one click', () => {
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByRole('button', { name: /Работа/ }).className).toContain('border-primary');
  });

  it('falls back to the first address when none is marked default', () => {
    addresses.mockReturnValue({ data: [ADDRESSES[0]] });
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByRole('button', { name: /Дом/ }).className).toContain('border-primary');
  });

  it('lets another address be chosen', async () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: /Дом/ }));
    placeOrder();

    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ addressId: 'addr-1' })),
    );
  });

  it('prompts for an address when there are none, and refuses to order', async () => {
    addresses.mockReturnValue({ data: [] });
    renderWithProviders(<CheckoutPage />);

    placeOrder();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Выберите адрес'));
    expect(checkout.mutateAsync).not.toHaveBeenCalled();
  });

  it('opens the new-address form on request', () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Новый адрес' }));

    expect(screen.getByLabelText('Улица')).toBeInTheDocument();
  });
});

describe('CheckoutPage — delivery time and payment', () => {
  it('defaults to as-soon-as-possible and cash', async () => {
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByRole('button', { name: 'Как можно скорее' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Наличными курьеру' })).toHaveAttribute('aria-pressed', 'true');

    placeOrder();

    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryType: 'ASAP', paymentMethod: 'CASH_ON_DELIVERY', scheduledAt: undefined }),
      ),
    );
  });

  it('asks for a time once a scheduled delivery is picked', async () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Ко времени' }));

    expect(screen.getByLabelText('Дата и время')).toBeInTheDocument();
    placeOrder();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Дата и время'));
    expect(checkout.mutateAsync).not.toHaveBeenCalled();
  });

  it('sends the scheduled time as an ISO timestamp', async () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Ко времени' }));
    fireEvent.change(screen.getByLabelText('Дата и время'), { target: { value: '2026-09-20T18:30' } });
    placeOrder();

    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryType: 'SCHEDULED',
          scheduledAt: new Date('2026-09-20T18:30').toISOString(),
        }),
      ),
    );
  });

  it('refuses a slot outside the opening hours before hitting the API', async () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Ко времени' }));
    // 04:00 — the kitchen is closed, and the server would reject it anyway.
    fireEvent.change(screen.getByLabelText('Дата и время'), { target: { value: '2026-09-20T04:00' } });
    placeOrder();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Мы работаем с 10:00 до 23:00 — выберите время в этом интервале',
      ),
    );
    expect(checkout.mutateAsync).not.toHaveBeenCalled();
  });

  it('refuses the closing hour itself', async () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Ко времени' }));
    // The last delivery leaves before 23:00, not at it.
    fireEvent.change(screen.getByLabelText('Дата и время'), { target: { value: '2026-09-20T23:15' } });
    placeOrder();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(checkout.mutateAsync).not.toHaveBeenCalled();
  });

  it('states the opening hours next to the picker', () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Ко времени' }));

    expect(screen.getByText('Доставляем ежедневно с 10:00 до 23:00')).toBeInTheDocument();
  });

  it('offers the earliest slot in local time, not UTC', () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Ко времени' }));

    // `toISOString()` would shift the minimum by the timezone offset.
    const min = screen.getByLabelText('Дата и время').getAttribute('min');
    const expected = new Date(Date.now() + 31 * 60_000);
    expect(min?.slice(0, 13)).toBe(
      new Date(expected.getTime() - expected.getTimezoneOffset() * 60_000).toISOString().slice(0, 13),
    );
  });

  it('switches to card on delivery', async () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Картой курьеру' }));
    placeOrder();

    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethod: 'CARD_ON_DELIVERY' }),
      ),
    );
  });

  it('says online payment is not available yet', () => {
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByText(/Онлайн-оплата скоро появится/)).toBeInTheDocument();
  });

  it('passes a comment along', async () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.change(screen.getByLabelText('Комментарий к заказу'), { target: { value: 'Позвонить заранее' } });
    placeOrder();

    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ comment: 'Позвонить заранее' })),
    );
  });
});

describe('CheckoutPage — discounts and totals', () => {
  it('charges the delivery fee the server returned', () => {
    renderWithProviders(<CheckoutPage />);

    // 630 ₽ of pizza plus 150 ₽ delivery.
    expect(screen.getByText(/780/)).toBeInTheDocument();
  });

  it('delivers free when the server waived the fee', () => {
    cart.mockReturnValue({ data: { ...CART, subtotal: 120000, deliveryFee: 0 }, isLoading: false });
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByText('Бесплатно')).toBeInTheDocument();
  });

  it('uppercases a promocode as it is typed', () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.change(screen.getByLabelText('Промокод'), { target: { value: 'chicago10' } });

    expect(screen.getByLabelText('Промокод')).toHaveValue('CHICAGO10');
  });

  it('applies a valid promocode to the total', async () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.change(screen.getByLabelText('Промокод'), { target: { value: 'CHICAGO10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Промокод применён'));
    // 630 − 63 discount + 150 delivery.
    expect(screen.getByText(/717/)).toBeInTheDocument();
  });

  it('reports a rejected promocode and keeps the total unchanged', async () => {
    checkPromocode.mutateAsync.mockRejectedValue(new ApiError('Промокод истёк', 400));
    renderWithProviders(<CheckoutPage />);

    fireEvent.change(screen.getByLabelText('Промокод'), { target: { value: 'OLD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Промокод истёк'));
    expect(screen.getByText(/780/)).toBeInTheDocument();
  });

  it('does not call the API for an empty promocode', () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));

    expect(checkPromocode.mutateAsync).not.toHaveBeenCalled();
  });

  it('hides the points field for a customer with none', () => {
    renderWithProviders(<CheckoutPage />);

    expect(screen.queryByLabelText('Списать баллы')).not.toBeInTheDocument();
  });

  it('offers to spend points and subtracts them', async () => {
    loyalty.mockReturnValue({ data: { points: 500 } });
    renderWithProviders(<CheckoutPage />);

    fireEvent.change(screen.getByLabelText('Списать баллы'), { target: { value: '100' } });

    // 630 − 100 ₽ of points + 150 delivery.
    expect(screen.getByText(/680/)).toBeInTheDocument();

    placeOrder();
    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ redeemPoints: 100 })),
    );
  });

  it('caps the points at what the order can absorb', () => {
    loyalty.mockReturnValue({ data: { points: 5000 } });
    renderWithProviders(<CheckoutPage />);

    fireEvent.change(screen.getByLabelText('Списать баллы'), { target: { value: '5000' } });

    // The cart is only 630 ₽, so at most 630 points may be spent.
    expect(screen.getByLabelText('Списать баллы')).toHaveValue(630);
  });

  it('sends no points when none were chosen', async () => {
    loyalty.mockReturnValue({ data: { points: 500 } });
    renderWithProviders(<CheckoutPage />);

    placeOrder();

    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ redeemPoints: undefined })),
    );
  });
});

describe('CheckoutPage — placing the order', () => {
  it('confirms and opens the new order', async () => {
    renderWithProviders(<CheckoutPage />);

    placeOrder();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Заказ оформлен!'));
    expect(router.push).toHaveBeenCalledWith('/orders/order-1');
  });

  it('reports a server refusal and stays on the page', async () => {
    checkout.mutateAsync.mockRejectedValue(new ApiError('Время доставки должно быть минимум через 30 минут', 400));
    renderWithProviders(<CheckoutPage />);

    placeOrder();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Время доставки должно быть минимум через 30 минут'),
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it('falls back to a generic message on an unexpected failure', async () => {
    checkout.mutateAsync.mockRejectedValue(new Error('offline'));
    renderWithProviders(<CheckoutPage />);

    placeOrder();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Не удалось оформить заказ'));
  });
});
