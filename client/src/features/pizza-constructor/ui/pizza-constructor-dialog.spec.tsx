import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import type { Product } from '@/shared/api/types';
import { PizzaConstructorDialog } from './pizza-constructor-dialog';

const toast = { success: vi.fn(), error: vi.fn() };
const addToCart = { mutateAsync: vi.fn(), isPending: false };
const user = vi.fn(() => ({ data: { id: 'user-1' } as Record<string, unknown> | null }));

vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a) },
}));
vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => user() }));
vi.mock('@/entities/cart/queries', () => ({ useAddToCart: () => addToCart }));
const MENU = [
  { id: 'i1', name: 'Моцарелла', price: 5000 },
  { id: 'i2', name: 'Бекон', price: 11000 },
];
const ingredients = vi.fn(() => MENU);

vi.mock('@/entities/product/queries', () => ({
  useDoughTypes: () => ({ data: [{ id: 'dough-thin', name: 'Тонкое', priceModifier: 0 }] }),
  useIngredients: () => ({ data: ingredients() }),
  useProducts: () => ({ data: { items: [{ id: 'p2', name: 'Барбекю' }] } }),
}));

const state = {
  isPizza: true,
  config: { productId: 'p1', sizeCm: 30 },
  quantity: 1,
  setQuantity: vi.fn(),
  sizeCm: 30,
  setSizeCm: vi.fn(),
  doughTypeId: 'dough-thin',
  setDoughTypeId: vi.fn(),
  secondHalfProductId: undefined as string | undefined,
  setSecondHalfProductId: vi.fn(),
  variantId: undefined as string | undefined,
  setVariantId: vi.fn(),
  removedIngredientIds: [] as string[],
  toggleRemovedIngredient: vi.fn(),
  price: { totalPrice: 44000 } as { totalPrice: number } | undefined,
  isPricing: false,
  priceError: null as unknown,
};

vi.mock('../model/use-pizza-config', () => ({ usePizzaConfig: () => state }));

const PIZZA = {
  id: 'p1',
  name: 'Пепперони',
  description: 'Острая пепперони',
  type: 'PIZZA',
  sizes: [
    { id: 's30', sizeCm: 30, label: '30 см', price: 44000 },
    { id: 's45', sizeCm: 45, label: '45 см', price: 63000 },
  ],
  ingredients: [{ id: 'i1', name: 'Моцарелла', price: 5000, isDefault: true }],
} as unknown as Product;

const DRINK = { id: 'd1', name: 'Кола', type: 'DRINK', sizes: [], ingredients: [] } as unknown as Product;

/** One menu line, one price, six flavours behind it. */
const KINZA = {
  id: 'd2',
  name: 'Kinza',
  type: 'DRINK',
  sizes: [],
  ingredients: [],
  variants: [
    { id: 'v1', name: 'Кола', slug: 'cola' },
    { id: 'v2', name: 'Лимон', slug: 'lemon' },
  ],
} as unknown as Product;

const open = (product: Product | null = PIZZA) =>
  renderWithProviders(<PizzaConstructorDialog product={product} open onOpenChange={vi.fn()} />);

beforeEach(() => {
  vi.clearAllMocks();
  user.mockReturnValue({ data: { id: 'user-1' } });
  ingredients.mockReturnValue(MENU);
  addToCart.mutateAsync.mockResolvedValue({ itemCount: 1 });
  Object.assign(state, {
    isPizza: true,
    quantity: 1,
    sizeCm: 30,
    price: { totalPrice: 44000 },
    isPricing: false,
    priceError: null,
  });
});

describe('PizzaConstructorDialog', () => {
  it('renders nothing without a product', () => {
    const { container } = renderWithProviders(
      <PizzaConstructorDialog product={null} open onOpenChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('offers every size the pizza comes in', () => {
    open();

    expect(screen.getByRole('button', { name: '30 см' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '45 см' })).toBeInTheDocument();
  });

  it('changes the size', () => {
    open();

    fireEvent.click(screen.getByRole('button', { name: '45 см' }));

    expect(state.setSizeCm).toHaveBeenCalledWith(45);
  });

  it('changes the dough', () => {
    open();

    fireEvent.click(screen.getByRole('button', { name: /Тонкое/ }));

    expect(state.setDoughTypeId).toHaveBeenCalledWith('dough-thin');
  });

  it('offers the other pizzas as a second half', () => {
    open();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p2' } });

    expect(state.setSecondHalfProductId).toHaveBeenCalledWith('p2');
  });

  it('treats the empty option as "one flavour"', () => {
    open();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });

    expect(state.setSecondHalfProductId).toHaveBeenCalledWith(undefined);
  });

  it('lets a recipe ingredient be taken off', () => {
    open();

    fireEvent.click(screen.getByLabelText('Моцарелла'));

    expect(state.toggleRemovedIngredient).toHaveBeenCalledWith('i1');
  });

  it('offers nothing to add — the pizzeria sells no paid extras', () => {
    open();

    // Бекон 
    // is on the ingredient menu but not in this pizza's recipe. It used
    // to appear as a tickable paid extra; now the only ingredients on screen
    // are the ones the pizza is made of.
    expect(screen.queryByText(/Бекон/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Моцарелла')).toBeInTheDocument();
  });

  it('shows the live price on the add button', () => {
    open();

    expect(screen.getByRole('button', { name: /Добавить в корзину/ })).toHaveTextContent('440');
  });

  it('waits for a price before allowing the add', () => {
    Object.assign(state, { price: undefined });
    open();

    expect(screen.getByRole('button', { name: /Добавить в корзину/ })).toBeDisabled();
  });

  it('adds the configured pizza to the cart', async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(<PizzaConstructorDialog product={PIZZA} open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Добавить в корзину/ }));

    await waitFor(() =>
      expect(addToCart.mutateAsync).toHaveBeenCalledWith({ config: { productId: 'p1', sizeCm: 30 }, quantity: 1 }),
    );
    expect(toast.success).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('lets a guest fill a basket without an account', async () => {
    // This used to assert the opposite — a redirect to /login — because the
    // check it tested was written before the guest cart existed. The rest of
    // that feature shipped and this stayed, which is how a whole reachable
    // path stayed unreachable with a green suite over it. `useAddToCart`
    // decides where the line goes; the dialog must not second-guess it.
    user.mockReturnValue({ data: null });
    open();

    fireEvent.click(screen.getByRole('button', { name: /Добавить в корзину/ }));

    await waitFor(() =>
      expect(addToCart.mutateAsync).toHaveBeenCalledWith({
        config: { productId: 'p1', sizeCm: 30 },
        quantity: 1,
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  /**
   * A drink sold in six flavours needs the customer to pick one, and the
   * dialog is the only place that asks. It used to show nothing but a
   * quantity stepper, so "Kinza" reached the kitchen with no flavour on it.
   */
  describe('flavours', () => {
    beforeEach(() => {
      Object.assign(state, { isPizza: false, variantId: 'v1' });
    });

    it('offers every flavour the drink comes in', () => {
      open(KINZA);

      expect(screen.getByRole('button', { name: 'Кола' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Лимон' })).toBeInTheDocument();
    });

    it('marks the chosen one, so the preselection is visible', () => {
      open(KINZA);

      expect(screen.getByRole('button', { name: 'Кола' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Лимон' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('changes the flavour', () => {
      open(KINZA);

      fireEvent.click(screen.getByRole('button', { name: 'Лимон' }));

      expect(state.setVariantId).toHaveBeenCalledWith('v2');
    });

    it('asks nothing of a drink sold only one way', () => {
      open(DRINK);

      expect(screen.queryByText('Вкус')).not.toBeInTheDocument();
    });
  });

  it('reports a server refusal', async () => {
    addToCart.mutateAsync.mockRejectedValue(new ApiError('Cart is full', 400));
    open();

    fireEvent.click(screen.getByRole('button', { name: /Добавить в корзину/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cart is full'));
  });

  it('steps the quantity within bounds', () => {
    Object.assign(state, { quantity: 1 });
    open();

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByRole('button', { name: '-' }));

    expect(state.setQuantity).toHaveBeenNthCalledWith(1, 2);
    // Never below one.
    expect(state.setQuantity).toHaveBeenNthCalledWith(2, 1);
  });

  it('caps the quantity at fifty', () => {
    Object.assign(state, { quantity: 50 });
    open();

    fireEvent.click(screen.getByRole('button', { name: '+' }));

    expect(state.setQuantity).toHaveBeenCalledWith(50);
  });

  /** A disabled button with no reason beside it is the bug, not the fix. */
  it('explains a price that could not be computed', () => {
    Object.assign(state, { price: undefined, priceError: new ApiError('Размер недоступен', 400) });
    open();

    expect(screen.getByRole('alert')).toHaveTextContent('Размер недоступен');
    expect(screen.getByRole('button', { name: /Добавить в корзину/ })).toBeDisabled();
  });

  it('keeps quiet about a price that is merely still loading', () => {
    Object.assign(state, { price: undefined, isPricing: true, priceError: new ApiError('boom', 500) });
    open();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides the pizza-only controls for a simple product', () => {
    Object.assign(state, { isPizza: false });
    open(DRINK);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Кола' })).toBeInTheDocument();
  });
});
