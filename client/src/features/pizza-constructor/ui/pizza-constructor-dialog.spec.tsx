import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import type { Product } from '@/shared/api/types';
import { MAX_ADDED_INGREDIENTS } from '../model/constraints';
import { PizzaConstructorDialog } from './pizza-constructor-dialog';

const router = { push: vi.fn() };
const toast = { success: vi.fn(), error: vi.fn() };
const addToCart = { mutateAsync: vi.fn(), isPending: false };
const user = vi.fn(() => ({ data: { id: 'user-1' } as Record<string, unknown> | null }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
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
  addedIngredientIds: [] as string[],
  toggleAddedIngredient: vi.fn(),
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
    addedIngredientIds: [],
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

  it('lets a recipe ingredient be removed and an extra added', () => {
    open();

    fireEvent.click(screen.getByLabelText('Моцарелла'));
    fireEvent.click(screen.getByText(/Бекон/));

    expect(state.toggleRemovedIngredient).toHaveBeenCalledWith('i1');
    expect(state.toggleAddedIngredient).toHaveBeenCalledWith('i2');
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

  it('sends a guest to sign in instead of failing silently', async () => {
    user.mockReturnValue({ data: null });
    open();

    fireEvent.click(screen.getByRole('button', { name: /Добавить в корзину/ }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/login?redirect=/menu'));
    expect(addToCart.mutateAsync).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Войдите, чтобы продолжить');
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

  /**
   * The menu carries more ingredients than one pizza may hold, and the API caps
   * the list at `MAX_ADDED_INGREDIENTS`. Ticking past the cap used to be
   * allowed: the price call answered 400, the price went away, and the add
   * button simply greyed out with nothing on screen to explain it.
   */
  describe('the extras ceiling', () => {
    const bigMenu = Array.from({ length: MAX_ADDED_INGREDIENTS + 3 }, (_, index) => ({
      id: `x${index}`,
      name: `Добавка ${index}`,
      price: 5000,
    }));
    const full = bigMenu.slice(0, MAX_ADDED_INGREDIENTS).map((i) => i.id);

    it('stops offering more extras once the pizza is full', () => {
      ingredients.mockReturnValue(bigMenu);
      Object.assign(state, { addedIngredientIds: full });
      open();

      // `fireEvent` would dispatch straight past the disabled attribute, so
      // the attribute itself is the assertion — it is what the browser obeys.
      expect(screen.getByRole('checkbox', { name: /Добавка 16/ })).toBeDisabled();
    });

    it('says why, rather than quietly refusing', () => {
      ingredients.mockReturnValue(bigMenu);
      Object.assign(state, { addedIngredientIds: full });
      open();

      expect(screen.getByRole('status')).toHaveTextContent(String(MAX_ADDED_INGREDIENTS));
    });

    it('still lets a chosen extra be taken back off', () => {
      ingredients.mockReturnValue(bigMenu);
      Object.assign(state, { addedIngredientIds: full });
      open();

      fireEvent.click(screen.getByRole('checkbox', { name: /Добавка 0/ }));

      expect(state.toggleAddedIngredient).toHaveBeenCalledWith('x0');
    });

    it('offers everything while there is room', () => {
      ingredients.mockReturnValue(bigMenu);
      Object.assign(state, { addedIngredientIds: full.slice(0, -1) });
      open();

      expect(screen.getByRole('checkbox', { name: /Добавка 16/ })).toBeEnabled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  /** A disabled button with no reason beside it is the bug, not the fix. */
  it('explains a price that could not be computed', () => {
    Object.assign(state, { price: undefined, priceError: new ApiError('Слишком много добавок', 400) });
    open();

    expect(screen.getByRole('alert')).toHaveTextContent('Слишком много добавок');
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
