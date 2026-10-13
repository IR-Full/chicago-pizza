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
const startPayment = { mutateAsync: vi.fn(), isPending: false };
/** Online payment is off unless a test switches it on. */
const paymentEnabled = vi.fn(() => ({ data: { enabled: false } as { enabled: boolean } | undefined }));
const branches = vi.fn(() => ({ data: BRANCHES as Record<string, unknown>[] }));
/** No zones drawn by default, so the flat tariff applies. */
const deliveryQuote = vi.fn((_coordinates: unknown) => ({
  data: { configured: false, zone: null } as Record<string, unknown> | undefined,
}));

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
const BRANCHES = [
  {
    id: 'branch-1',
    name: 'Chicago Pizza на Гамзатова',
    slug: 'gamzatova',
    address: 'Махачкала, пр. Расула Гамзатова, 45',
    lat: null,
    lng: null,
    floor: '1 этаж',
    phone: '+7 8722 55-55-55',
    // 11:30 — 23:30 as minutes from midnight.
    openMinute: 690,
    closeMinute: 1410,
  },
  {
    id: 'branch-2',
    name: 'Chicago Pizza на Акушинского',
    slug: 'akushinskogo',
    address: 'Махачкала, пр. Акушинского, 90',
    lat: null,
    lng: null,
    floor: 'Цокольный этаж',
    phone: '+7 8722 55-55-56',
    openMinute: 690,
    // Works until six in the morning: `closeMinute` below `openMinute` is
    // how the model spells "past midnight".
    closeMinute: 360,
  },
];

const ADDRESSES = [
  {
    id: 'addr-1',
    title: 'Дом',
    city: 'Махачкала',
    street: 'Ленина',
    house: '1',
    apartment: '5',
    isDefault: false,
  },
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
vi.mock('@/entities/cart/queries', () => ({
  useCart: () => cart(),
  useCheckPromocode: () => checkPromocode,
}));
vi.mock('@/entities/product/queries', () => ({
  useBranches: () => branches(),
  useDeliveryQuote: (coordinates: unknown) => deliveryQuote(coordinates),
}));
vi.mock('@/entities/order/queries', () => ({
  useCheckout: () => checkout,
  usePaymentEnabled: () => paymentEnabled(),
  useStartPayment: () => startPayment,
}));

beforeEach(() => {
  vi.clearAllMocks();
  user.mockReturnValue({
    data: { id: 'user-1', email: 'guest@chicago.ru', isEmailVerified: true },
    isLoading: false,
  });
  cart.mockReturnValue({ data: CART, isLoading: false });
  addresses.mockReturnValue({ data: ADDRESSES });
  loyalty.mockReturnValue({ data: { points: 0 } });
  branches.mockReturnValue({ data: BRANCHES });
  deliveryQuote.mockReturnValue({ data: { configured: false, zone: null } });
  checkPromocode.mutateAsync.mockResolvedValue({ promocodeId: 'promo-1', code: 'CHICAGO10', discount: 6300 });
  checkout.mutateAsync.mockImplementation(async (payload) => ({
    id: 'order-1',
    paymentMethod: payload.paymentMethod,
    total: 78_000,
  }));
  startPayment.mutateAsync.mockResolvedValue({ confirmationUrl: 'https://pay.example/yk-1' });
  paymentEnabled.mockReturnValue({ data: { enabled: false } });
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
    cart.mockReturnValue({
      data: { ...CART, lines: [], subtotal: 0, itemCount: 0, total: 0 },
      isLoading: false,
    });
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

  /**
   * The disabled button is a courtesy; the network is what actually repeats a
   * request. Both submissions have to carry the same key or the server sees
   * two separate orders.
   */
  it('stamps every submission of one visit with the same attempt key', async () => {
    renderWithProviders(<CheckoutPage />);

    placeOrder();
    await waitFor(() => expect(checkout.mutateAsync).toHaveBeenCalled());
    placeOrder();
    await waitFor(() => expect(checkout.mutateAsync).toHaveBeenCalledTimes(2));

    const keys = checkout.mutateAsync.mock.calls.map(([payload]) => payload.idempotencyKey);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[0]).toHaveLength(36);
    expect(keys[1]).toBe(keys[0]);
  });

  it('gives a fresh attempt key to a new visit to the screen', async () => {
    const first = renderWithProviders(<CheckoutPage />);
    placeOrder();
    await waitFor(() => expect(checkout.mutateAsync).toHaveBeenCalled());
    first.unmount();

    renderWithProviders(<CheckoutPage />);
    placeOrder();
    await waitFor(() => expect(checkout.mutateAsync).toHaveBeenCalledTimes(2));

    const [firstKey, secondKey] = checkout.mutateAsync.mock.calls.map(([p]) => p.idempotencyKey);
    expect(secondKey).not.toBe(firstKey);
  });

  /**
   * The server refuses an order from an unverified address. Finding that out
   * after filling in the whole form is the worst possible moment.
   */
  it('asks an unverified customer to confirm their address instead of the form', async () => {
    user.mockReturnValue({
      data: { id: 'user-1', email: 'guest@chicago.ru', isEmailVerified: false },
      isLoading: false,
    });
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByText('Подтвердите email')).toBeInTheDocument();
    expect(screen.getByText(/guest@chicago.ru/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Подтвердить email' })).toHaveAttribute(
      'href',
      '/verify-email?email=guest%40chicago.ru',
    );
    expect(screen.queryByRole('button', { name: 'Оформить заказ' })).not.toBeInTheDocument();
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
        expect.objectContaining({
          deliveryType: 'ASAP',
          paymentMethod: 'CASH_ON_DELIVERY',
          scheduledAt: undefined,
        }),
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
        'Мы работаем с 11:30 до 23:30 — выберите время в этом интервале',
      ),
    );
    expect(checkout.mutateAsync).not.toHaveBeenCalled();
  });

  it('refuses the closing hour itself', async () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Ко времени' }));
    // The last delivery leaves before 23:30, not at it.
    fireEvent.change(screen.getByLabelText('Дата и время'), { target: { value: '2026-09-20T23:45' } });
    placeOrder();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(checkout.mutateAsync).not.toHaveBeenCalled();
  });

  it('states the opening hours next to the picker', () => {
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Ко времени' }));

    expect(screen.getByText('Доставляем ежедневно с 11:30 до 23:30')).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('Комментарий к заказу'), {
      target: { value: 'Позвонить заранее' },
    });
    placeOrder();

    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ comment: 'Позвонить заранее' }),
      ),
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
    checkout.mutateAsync.mockRejectedValue(
      new ApiError('Время доставки должно быть минимум через 30 минут', 400),
    );
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

/**
 * A collection and a delivery are different orders: one names a kitchen and
 * carries no address, the other the reverse. The fee is the visible
 * difference — nobody drives anywhere, so nobody pays for it.
 */
describe('CheckoutPage — collecting instead of delivering', () => {
  const choosePickup = () => fireEvent.click(screen.getByRole('button', { name: 'Самовывоз' }));

  it('offers the chain’s kitchens once pickup is chosen', () => {
    renderWithProviders(<CheckoutPage />);
    choosePickup();

    expect(screen.getByText('Chicago Pizza на Гамзатова')).toBeInTheDocument();
    expect(screen.getByText(/пр. Акушинского, 90/)).toBeInTheDocument();
  });

  it('hides the address picker, which has nothing to say about a collection', () => {
    renderWithProviders(<CheckoutPage />);
    choosePickup();

    expect(screen.queryByRole('button', { name: 'Новый адрес' })).not.toBeInTheDocument();
  });

  it('charges nothing for delivery', () => {
    renderWithProviders(<CheckoutPage />);
    choosePickup();

    expect(screen.getByText('Без платы за доставку')).toBeInTheDocument();
    // Subtotal and total are the same number: 630 ₽ of pizza, no 150 ₽ on top.
    expect(screen.getAllByText(/630/)).toHaveLength(2);
    expect(screen.queryByText(/150/)).not.toBeInTheDocument();
  });

  it('sends the branch and no address', async () => {
    renderWithProviders(<CheckoutPage />);
    choosePickup();
    placeOrder();

    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ fulfillment: 'PICKUP', branchId: 'branch-1', addressId: undefined }),
      ),
    );
  });

  it('lets another kitchen be chosen', async () => {
    renderWithProviders(<CheckoutPage />);
    choosePickup();

    fireEvent.click(screen.getByText('Chicago Pizza на Акушинского'));
    placeOrder();

    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'branch-2' })),
    );
  });

  it('refuses to order when the chain has nothing open', async () => {
    branches.mockReturnValue({ data: [] });
    renderWithProviders(<CheckoutPage />);
    choosePickup();
    placeOrder();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Выберите пиццерию'));
    expect(checkout.mutateAsync).not.toHaveBeenCalled();
  });

  it('sends a delivery with an address and no branch', async () => {
    renderWithProviders(<CheckoutPage />);
    placeOrder();

    await waitFor(() =>
      expect(checkout.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ fulfillment: 'DELIVERY', addressId: 'addr-2', branchId: undefined }),
      ),
    );
  });
});

describe('CheckoutPage — scheduling against the chosen kitchen', () => {
  /** A slot tomorrow at `hour`, in the visitor's own clock. */
  const tomorrowAt = (hour: number) => {
    const when = new Date();
    when.setDate(when.getDate() + 1);
    when.setHours(hour, 30, 0, 0);
    const local = new Date(when.getTime() - when.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  };

  const scheduleFor = (hour: number) => {
    fireEvent.click(screen.getByRole('button', { name: 'Ко времени' }));
    fireEvent.change(screen.getByLabelText('Дата и время'), { target: { value: tomorrowAt(hour) } });
  };

  it('accepts 01:30 at the branch that works through the night', async () => {
    renderWithProviders(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Самовывоз' }));
    fireEvent.click(screen.getByText('Chicago Pizza на Акушинского'));
    scheduleFor(1);
    placeOrder();

    // Everyone else shut two hours ago. A comparison that could not wrap
    // past midnight would refuse this — and refuse this branch every hour
    // of the day.
    await waitFor(() => expect(checkout.mutateAsync).toHaveBeenCalled());
  });

  it('refuses 01:30 at the branch that closes at 23:30', async () => {
    renderWithProviders(<CheckoutPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Самовывоз' }));
    scheduleFor(1);
    placeOrder();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('23:30')));
    expect(checkout.mutateAsync).not.toHaveBeenCalled();
  });
});

/**
 * A flat tariff across a city is a promise the kitchen cannot keep evenly.
 * Once a zone covers the address, the zone's own price is the one shown — and
 * an address nobody covers is a refusal the customer should see before they
 * press the button, not after.
 */
describe('CheckoutPage — delivery zones', () => {
  const zone = (over: Record<string, unknown> = {}) => ({
    data: {
      configured: true,
      zone: {
        id: 'zone-centre',
        name: 'Центр',
        branchId: 'branch-1',
        deliveryFee: 10_000,
        minOrderAmount: 0,
        ...over,
      },
    },
  });

  it('quotes the zone’s price and names it', () => {
    deliveryQuote.mockReturnValue(zone());
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByText('Зона «Центр»')).toBeInTheDocument();
    expect(screen.getByText('100 ₽')).toBeInTheDocument();
  });

  it('asks about the selected address, not about a pickup', () => {
    renderWithProviders(<CheckoutPage />);

    // 'addr-2' is the default address, and it carries a pin.
    expect(deliveryQuote).toHaveBeenCalledWith(expect.objectContaining({ id: 'addr-2' }));
  });

  it('stops asking once the customer switches to pickup', () => {
    renderWithProviders(<CheckoutPage />);
    deliveryQuote.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Самовывоз' }));

    expect(deliveryQuote).toHaveBeenLastCalledWith(null);
  });

  it('refuses an address outside every zone, and disables the button', async () => {
    deliveryQuote.mockReturnValue({ data: { configured: true, zone: null } });
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Мы пока не доставляем по этому адресу');
    expect(screen.getByRole('button', { name: 'Подтвердить заказ' })).toBeDisabled();
  });

  it('refuses an order below the zone’s minimum', () => {
    deliveryQuote.mockReturnValue(zone({ minOrderAmount: 100_000 }));
    renderWithProviders(<CheckoutPage />);

    // The cart holds 630 ₽ of pizza against a 1000 ₽ minimum.
    expect(screen.getByRole('status')).toHaveTextContent('Минимальный заказ в этой зоне');
    expect(screen.getByRole('button', { name: 'Подтвердить заказ' })).toBeDisabled();
  });

  it('keeps the flat tariff where no zone is drawn', () => {
    renderWithProviders(<CheckoutPage />);

    // "Доставка" is also the label of the fulfillment button, so scope to the
    // summary row where the tariff is quoted.
    expect(screen.queryByText(/Зона «/)).not.toBeInTheDocument();
    expect(screen.getByText('150 ₽')).toBeInTheDocument();
  });

  it('ignores zones entirely for a collection', () => {
    deliveryQuote.mockReturnValue(zone({ deliveryFee: 25_000 }));
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Самовывоз' }));

    expect(screen.getByText('Без платы за доставку')).toBeInTheDocument();
  });
});

/**
 * Offering a payment method the shop cannot take is worse than not offering
 * it: the customer finds out at the last click.
 */
describe('CheckoutPage — paying online', () => {
  it('offers nothing online when the shop has no merchant account', () => {
    renderWithProviders(<CheckoutPage />);

    expect(screen.queryByRole('button', { name: 'Картой или СБП онлайн' })).not.toBeInTheDocument();
  });

  it('offers it once the provider is configured', () => {
    paymentEnabled.mockReturnValue({ data: { enabled: true } });
    renderWithProviders(<CheckoutPage />);

    expect(screen.getByRole('button', { name: 'Картой или СБП онлайн' })).toBeInTheDocument();
  });

  it('sends the customer to the bank page after placing the order', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign } as never);
    paymentEnabled.mockReturnValue({ data: { enabled: true } });
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Картой или СБП онлайн' }));
    placeOrder();

    await waitFor(() => expect(startPayment.mutateAsync).toHaveBeenCalledWith('order-1'));
    expect(assign).toHaveBeenCalledWith('https://pay.example/yk-1');
    expect(router.push).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('lands on the order rather than stranding it when the payment page fails', async () => {
    paymentEnabled.mockReturnValue({ data: { enabled: true } });
    startPayment.mutateAsync.mockRejectedValue(new Error('provider down'));
    renderWithProviders(<CheckoutPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Картой или СБП онлайн' }));
    placeOrder();

    // The order exists; its own page offers the same button.
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/orders/order-1'));
    expect(toast.error).toHaveBeenCalledWith('Не удалось открыть оплату');
  });

  it('does not touch the payment flow for an order paid at the door', async () => {
    renderWithProviders(<CheckoutPage />);
    placeOrder();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/orders/order-1'));
    expect(startPayment.mutateAsync).not.toHaveBeenCalled();
  });
});
