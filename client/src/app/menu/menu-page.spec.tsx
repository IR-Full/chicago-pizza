import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, hashKey } from '@tanstack/react-query';
import { renderWithProviders, resolveServerTree } from '@/test/utils';
import { resetTestRouter, setTestUrl } from '@/test/next-navigation';
import type { Paginated, Product } from '@/shared/api/types';
import { parseCatalogParams, readerFromRecord } from '@/entities/product/catalog-params';
import { productKeys } from '@/entities/product/keys';
import MenuPage, { generateMetadata } from './page';

const list = vi.fn();
const categories = vi.fn();

vi.mock('@/entities/product/api', () => ({
  productApi: {
    list: (...args: unknown[]) => list(...args),
    categories: () => categories(),
  },
}));

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationMock);

vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => ({ data: null }) }));
vi.mock('@/features/pizza-constructor/ui/pizza-constructor-dialog', () => ({
  PizzaConstructorDialog: () => null,
}));

const PIZZA = {
  id: 'p1',
  name: 'Пепперони',
  slug: 'pepperoni',
  description: null,
  imageUrl: null,
  type: 'PIZZA',
  isVegetarian: false,
  isSpicy: true,
  isHalal: true,
  isNew: false,
  isPopular: true,
  isAvailable: true,
  stoppedUntil: null,
  category: null,
  sizes: [],
  priceFrom: 44000,
  ingredients: [],
} as unknown as Product;

const PAGE: Paginated<Product> = { items: [PIZZA], total: 1, page: 1, limit: 24, totalPages: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  resetTestRouter('/menu');
  list.mockResolvedValue(PAGE);
  categories.mockResolvedValue([{ id: 'c1', name: 'Пиццы', slug: 'pizza' }]);
});

describe('MenuPage — server rendering', () => {
  it('gives pagination its own canonical URL and excludes search duplicates from indexing', async () => {
    const page = await generateMetadata({ searchParams: Promise.resolve({ page: '2' }) });
    expect(page.alternates?.canonical).toMatch(/\/menu\?page=2$/);
    const search = await generateMetadata({ searchParams: Promise.resolve({ q: 'Kinza', page: '2' }) });
    expect(search.robots).toEqual({ index: false, follow: true });
    expect(search.alternates?.canonical).toMatch(/\/menu$/);
    const invalidPage = await generateMetadata({ searchParams: Promise.resolve({ page: '-1' }) });
    expect(invalidPage.alternates?.canonical).toMatch(/\/menu$/);
  });
  it('fetches the menu on the server, so the HTML already contains it', async () => {
    const tree = await resolveServerTree(<MenuPage searchParams={Promise.resolve({})} />);

    // Fetched during the server render, before anything mounted in a browser.
    expect(list).toHaveBeenCalledTimes(1);

    setTestUrl('/menu');
    renderWithProviders(tree as React.ReactElement);

    // And the product is in the markup on the first paint: `/menu` used to ship
    // a skeleton and then go and get the menu client-side.
    expect(screen.getByRole('heading', { name: 'Пепперони' })).toBeInTheDocument();
  });

  it('hands the hydrated page to the browser instead of fetching it again', async () => {
    const tree = await resolveServerTree(<MenuPage searchParams={Promise.resolve({})} />);
    expect(list).toHaveBeenCalledTimes(1);

    setTestUrl('/menu');
    // Mirrors `Providers`: the app's real `staleTime` is what decides whether
    // hydrated data is reused or immediately refetched. The default test client
    // uses 0, which would refetch and hide a broken prefetch behind a working
    // page.
    renderWithProviders(tree as React.ReactElement, {
      queryClient: new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 30_000 } },
      }),
    });

    expect(screen.getByRole('heading', { name: 'Пепперони' })).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('dehydrates the page under the very hash the widget looks up', async () => {
    // This is the whole risk of the change. A key that differs by one field is
    // not an error — it is a silent cache miss, and the visitor pays for the
    // same page of products twice. So this reads the hashes actually shipped in
    // the dehydrated payload, rather than recomputing the expectation the same
    // way the page did and proving only that a function is deterministic.
    const params = { category: 'pizza', halal: '1', page: '2' };
    const filters = parseCatalogParams(readerFromRecord(params));

    const tree = (await resolveServerTree(
      <MenuPage searchParams={Promise.resolve(params)} />,
    )) as React.ReactElement<{ state: { queries: { queryHash: string }[] } }>;

    const shipped = tree.props.state.queries.map((query) => query.queryHash);

    expect(shipped).toContain(hashKey(productKeys.list(filters)));
    expect(shipped).toContain(hashKey(productKeys.categories));
    expect(list).toHaveBeenCalledWith(filters);
  });

  it('forwards the URL filters to the API rather than fetching the whole menu', async () => {
    await resolveServerTree(
      <MenuPage searchParams={Promise.resolve({ category: 'drinks', veg: '1', page: '3' })} />,
    );

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ categorySlug: 'drinks', isVegetarian: true, page: 3, limit: 24 }),
    );
  });

  it('still renders when the gateway is down', async () => {
    list.mockRejectedValue(new Error('gateway down'));
    categories.mockRejectedValue(new Error('gateway down'));

    const tree = await resolveServerTree(<MenuPage searchParams={Promise.resolve({})} />);
    setTestUrl('/menu');
    renderWithProviders(tree as React.ReactElement);

    // A hiccup upstream must not turn the menu into an error screen; the
    // browser retries on its own.
    expect(screen.getByRole('heading', { level: 1, name: 'Меню' })).toBeInTheDocument();
  });
});
