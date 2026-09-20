import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import type { Product } from '@/shared/api/types';
import { CatalogView } from './catalog-view';
import { HomeProductGrid } from '@/widgets/home/home-product-grid';

const products = vi.fn();
const favorites = vi.fn(() => ({ data: [] as Product[] }));
const toggleFavorite = { mutate: vi.fn() };
const user = vi.fn(() => ({ data: null as Record<string, unknown> | null }));

const PIZZA = {
  id: 'p1',
  name: 'Пепперони',
  slug: 'pepperoni',
  description: 'Острая пепперони',
  imageUrl: null,
  type: 'PIZZA',
  isVegetarian: false,
  isSpicy: true,
  isNew: false,
  isPopular: true,
  category: null,
  sizes: [],
  priceFrom: 44000,
  ingredients: [],
} as unknown as Product;

vi.mock('@/entities/product/queries', () => ({
  useProducts: (...args: unknown[]) => products(...args),
  useCategories: () => ({ data: [{ id: 'c1', name: 'Пиццы', slug: 'pizza' }, { id: 'c2', name: 'Напитки', slug: 'drinks' }] }),
  useFavorites: () => favorites(),
  useToggleFavorite: () => toggleFavorite,
}));

vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => user() }));

// The constructor has its own spec; here it only needs to report that it opened.
vi.mock('@/features/pizza-constructor/ui/pizza-constructor-dialog', () => ({
  PizzaConstructorDialog: ({ product, open }: { product: Product | null; open: boolean }) =>
    open ? <div role="dialog">{product?.name}</div> : null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  user.mockReturnValue({ data: null });
  favorites.mockReturnValue({ data: [] });
  products.mockReturnValue({ data: { items: [PIZZA], totalPages: 1 }, isLoading: false });
});

describe('CatalogView — layout', () => {
  it('shows the menu heading, search and filter toggle', () => {
    renderWithProviders(<CatalogView />);

    expect(screen.getByRole('heading', { level: 1, name: 'Меню' })).toBeInTheDocument();
    expect(screen.getByLabelText('Поиск')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Фильтры' })).toBeInTheDocument();
  });

  it('lists the categories as chips, with "Все" selected by default', () => {
    renderWithProviders(<CatalogView />);

    expect(screen.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Пиццы' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Напитки' })).toBeInTheDocument();
  });

  it('renders the products it received', () => {
    renderWithProviders(<CatalogView />);

    expect(screen.getByRole('heading', { name: 'Пепперони' })).toBeInTheDocument();
  });

  it('shows skeletons while loading', () => {
    products.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = renderWithProviders(<CatalogView />);

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('says so when nothing matches', () => {
    products.mockReturnValue({ data: { items: [] }, isLoading: false });
    renderWithProviders(<CatalogView />);

    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
  });
});

describe('CatalogView — filtering', () => {
  it('starts on the category the page was opened with', () => {
    renderWithProviders(<CatalogView initialCategory="drinks" />);

    expect(products).toHaveBeenLastCalledWith(expect.objectContaining({ categorySlug: 'drinks' }));
    expect(screen.getByRole('button', { name: 'Напитки' })).toHaveAttribute('aria-current', 'true');
  });

  it('switches category on a chip click', () => {
    renderWithProviders(<CatalogView />);

    fireEvent.click(screen.getByRole('button', { name: 'Напитки' }));

    expect(products).toHaveBeenLastCalledWith(expect.objectContaining({ categorySlug: 'drinks' }));
  });

  it('clears the category with "Все"', () => {
    renderWithProviders(<CatalogView initialCategory="pizza" />);

    fireEvent.click(screen.getByRole('button', { name: 'Все' }));

    expect(products).toHaveBeenLastCalledWith(expect.objectContaining({ categorySlug: undefined }));
  });

  it('debounces the search rather than querying per keystroke', async () => {
    renderWithProviders(<CatalogView />);

    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'сыр' } });

    expect(products).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'сыр' }));
    await waitFor(() => expect(products).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'сыр' })), {
      timeout: 2000,
    });
  });

  it('opens the filter panel and applies a flag', () => {
    renderWithProviders(<CatalogView />);

    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));
    fireEvent.click(screen.getByLabelText('Вегетарианское'));

    expect(products).toHaveBeenLastCalledWith(expect.objectContaining({ isVegetarian: true }));
  });

  it('sends a flag only when it is on, so "off" never filters everything out', () => {
    renderWithProviders(<CatalogView />);

    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));

    expect(products).toHaveBeenLastCalledWith(
      expect.objectContaining({ isVegetarian: undefined, isSpicy: undefined }),
    );
  });

  it('offers a reset once something is active, and clears everything', async () => {
    renderWithProviders(<CatalogView />);
    fireEvent.click(screen.getByRole('button', { name: 'Фильтры' }));

    expect(screen.queryByRole('button', { name: 'Сбросить' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Острое'));
    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'сыр' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));

    await waitFor(() =>
      expect(products).toHaveBeenLastCalledWith(expect.objectContaining({ isSpicy: undefined, search: undefined })),
    );
    expect(screen.getByLabelText('Поиск')).toHaveValue('');
  });
});

describe('CatalogView — favorites and the constructor', () => {
  it('hides favorite controls from a guest', () => {
    renderWithProviders(<CatalogView />);

    expect(screen.queryByRole('button', { name: 'Пепперони' })).not.toBeInTheDocument();
  });

  it('lets a signed-in customer toggle a favorite', () => {
    user.mockReturnValue({ data: { id: 'user-1' } });
    renderWithProviders(<CatalogView />);

    fireEvent.click(screen.getByRole('button', { name: 'Пепперони' }));

    expect(toggleFavorite.mutate).toHaveBeenCalledWith({ productId: 'p1', isFavorite: false });
  });

  it('knows a product that is already a favorite', () => {
    user.mockReturnValue({ data: { id: 'user-1' } });
    favorites.mockReturnValue({ data: [PIZZA] });
    renderWithProviders(<CatalogView />);

    expect(screen.getByRole('button', { name: 'Пепперони' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Пепперони' }));
    expect(toggleFavorite.mutate).toHaveBeenCalledWith({ productId: 'p1', isFavorite: true });
  });

  it('opens the constructor for the chosen pizza', () => {
    renderWithProviders(<CatalogView />);

    fireEvent.click(screen.getByRole('button', { name: 'Собрать' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Пепперони');
  });
});

describe('HomeProductGrid', () => {
  it('renders a card per product', () => {
    renderWithProviders(<HomeProductGrid products={[PIZZA, { ...PIZZA, id: 'p2', name: 'Барбекю' } as Product]} />);

    expect(screen.getByRole('heading', { name: 'Пепперони' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Барбекю' })).toBeInTheDocument();
  });

  it('opens the constructor from a card', () => {
    renderWithProviders(<HomeProductGrid products={[PIZZA]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Собрать' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Пепперони');
  });

  it('renders nothing for an empty list', () => {
    renderWithProviders(<HomeProductGrid products={[]} />);

    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

describe('CatalogView — pagination', () => {
  it('asks for the first page of a bounded size, not the whole menu', () => {
    renderWithProviders(<CatalogView />);

    expect(products).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 24 }));
  });

  it('hides the controls while everything fits on one page', () => {
    renderWithProviders(<CatalogView />);

    expect(screen.queryByRole('navigation', { name: 'Страницы' })).not.toBeInTheDocument();
  });

  it('walks to the next page', () => {
    products.mockReturnValue({ data: { items: [PIZZA], totalPages: 3 }, isLoading: false });
    renderWithProviders(<CatalogView />);

    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));

    expect(products).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  it('returns to the first page when the filters change', async () => {
    products.mockReturnValue({ data: { items: [PIZZA], totalPages: 3 }, isLoading: false });
    renderWithProviders(<CatalogView />);

    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));
    expect(products).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    // Page 2 of the old result set is very probably empty in the new one.
    fireEvent.click(screen.getByRole('button', { name: 'Пиццы' }));

    await waitFor(() =>
      expect(products).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, categorySlug: 'pizza' })),
    );
  });
});
