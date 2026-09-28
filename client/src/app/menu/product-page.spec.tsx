import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import { productApi } from '@/entities/product/api';
import ProductPage, { generateMetadata } from './[slug]/page';
import sitemap from '../sitemap';
import robots from '../robots';

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({ notFound: () => notFound(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/entities/product/api', () => ({
  productApi: { get: vi.fn(), list: vi.fn(), recommendations: vi.fn() },
}));
vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => ({ data: null }) }));
vi.mock('@/entities/product/queries', () => ({
  useFavorites: () => ({ data: [] }),
  useToggleFavorite: () => ({ mutate: vi.fn() }),
  useDoughTypes: () => ({ data: [] }),
  useIngredients: () => ({ data: [] }),
  useProducts: () => ({ data: { items: [] } }),
}));
vi.mock('@/features/pizza-constructor/ui/pizza-constructor-dialog', () => ({
  PizzaConstructorDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="constructor" /> : null,
}));

const PRODUCT = {
  id: 'p1',
  name: 'Пепперони',
  slug: 'pepperoni',
  description: 'Острая пепперони и моцарелла',
  imageUrl: null,
  type: 'PIZZA',
  isVegetarian: false,
  isSpicy: true,
  isNew: false,
  isPopular: true,
  category: { id: 'c1', name: 'Пиццы', slug: 'pizza' },
  sizes: [
    { id: 's1', sizeCm: 30, label: '30 см', price: 49000 },
    { id: 's2', sizeCm: 45, label: '45 см', price: 69000 },
  ],
  priceFrom: 49000,
  ingredients: [
    { id: 'i1', name: 'Пепперони', price: 0, isDefault: true },
    // On the ingredient menu but not in this pizza. It used to be listed as
    // a paid extra; the pizzeria sells none, so it should not appear at all.
    { id: 'i2', name: 'Халапеньо', price: 5000, isDefault: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productApi.get).mockResolvedValue(PRODUCT as never);
  vi.mocked(productApi.list).mockResolvedValue({ items: [PRODUCT] } as never);
});

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe('product page', () => {
  it('renders the item, its recipe and its sizes', async () => {
    renderWithProviders(await ProductPage(params('pepperoni')));

    expect(screen.getByRole('heading', { level: 1, name: 'Пепперони' })).toBeInTheDocument();
    expect(screen.getByText('Острая пепперони и моцарелла')).toBeInTheDocument();
    expect(screen.getByText(/30 см/)).toBeInTheDocument();

    // The recipe, read out of its own section — "Пепперони" names both this
    // pizza and one of its toppings, so a page-wide match finds two.
    const composition = screen.getByRole('heading', { name: 'Состав' }).parentElement!;
    expect(composition).toHaveTextContent('Пепперони');
  });

  it('does not offer the rest of the ingredient menu as paid extras', async () => {
    renderWithProviders(await ProductPage(params('pepperoni')));

    // Халапеньо is on the menu but not in this pizza, and there is no
    // longer anything to add it to.
    expect(screen.queryByText(/Халапеньо/)).not.toBeInTheDocument();
  });

  it('opens the constructor from the item page', async () => {
    renderWithProviders(await ProductPage(params('pepperoni')));

    fireEvent.click(screen.getByRole('button', { name: 'Собрать' }));

    await waitFor(() => expect(screen.getByTestId('constructor')).toBeInTheDocument());
  });

  it('404s on an unknown slug instead of failing the render', async () => {
    vi.mocked(productApi.get).mockRejectedValue(new ApiError('Товар не найден', 404));

    await expect(ProductPage(params('ghost'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('lets a real failure surface rather than pretending the item is gone', async () => {
    vi.mocked(productApi.get).mockRejectedValue(new ApiError('Internal', 500));

    await expect(ProductPage(params('pepperoni'))).rejects.toThrow('Internal');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('carries structured data so the price can show in search results', async () => {
    const { container } = renderWithProviders(await ProductPage(params('pepperoni')));

    const script = container.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script!.innerHTML);

    expect(data).toMatchObject({ '@type': 'MenuItem', name: 'Пепперони' });
    // Roubles, not kopecks: schema.org would read 49000 as ₽49 000.
    expect(data.offers).toEqual([
      expect.objectContaining({ name: '30 см', price: 490, priceCurrency: 'RUB' }),
      expect.objectContaining({ name: '45 см', price: 690 }),
    ]);
  });
});

describe('product page — metadata', () => {
  it('titles the page after the item and describes it in its own words', async () => {
    const meta = await generateMetadata(params('pepperoni'));

    expect(meta.title).toBe('Пепперони');
    expect(meta.description).toBe('Острая пепперони и моцарелла');
    expect(meta.alternates?.canonical).toMatch(/\/menu\/pepperoni$/);
  });

  it('falls back to a generated description when the item has none', async () => {
    vi.mocked(productApi.get).mockResolvedValue({ ...PRODUCT, description: null } as never);

    const meta = await generateMetadata(params('pepperoni'));

    expect(meta.description).toContain('от 490 ₽');
  });

  it('does not invent a title for an item that is gone', async () => {
    vi.mocked(productApi.get).mockRejectedValue(new ApiError('Товар не найден', 404));

    await expect(generateMetadata(params('ghost'))).resolves.toEqual({ title: 'Товар не найден' });
  });
});

describe('sitemap and robots', () => {
  it('lists the public pages and one entry per menu item', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toContain('http://localhost:3000/menu');
    expect(urls).toContain('http://localhost:3000/menu/pepperoni');
  });

  /**
   * The page size has to be one the catalog API will actually serve: asking
   * for more is a 400, and the `catch` turns that into a sitemap with no
   * products in it — which looks exactly like a working sitemap.
   */
  it('asks for a page the catalog API will accept', async () => {
    await sitemap();

    const { limit } = vi.mocked(productApi.list).mock.calls[0][0]!;
    expect(limit).toBeLessThanOrEqual(100);
  });

  it('still answers when the catalog is down', async () => {
    vi.mocked(productApi.list).mockRejectedValue(new Error('gateway down'));

    // Four static pages beat a 500 — the menu returns on the next revalidation.
    await expect(sitemap()).resolves.toHaveLength(4);
  });

  it('keeps crawlers out of everything behind a login', () => {
    const { rules, sitemap: sitemapUrl } = robots();
    const disallow = (rules as { disallow: string[] }).disallow;

    for (const path of ['/admin', '/checkout', '/orders', '/profile']) {
      expect(disallow).toContain(path);
    }
    expect(sitemapUrl).toBe('http://localhost:3000/sitemap.xml');
  });
});

/**
 * Halal is not decoration on a menu in Makhachkala — for a large share of
 * customers it is the first thing they filter by.
 */
describe('halal marking', () => {
  it('shows the badge on an item that carries the claim', async () => {
    vi.mocked(productApi.get).mockResolvedValue({ ...PRODUCT, isHalal: true } as never);

    renderWithProviders(await ProductPage(params('pepperoni')));

    expect(screen.getByText('Халяль')).toBeInTheDocument();
  });

  it('says nothing about an item that does not', async () => {
    vi.mocked(productApi.get).mockResolvedValue({ ...PRODUCT, isHalal: false } as never);

    // Silence is the honest default: the flag is a supplier statement, and an
    // absent one must never read as "probably fine".
    renderWithProviders(await ProductPage(params('pepperoni')));

    expect(screen.queryByText('Халяль')).not.toBeInTheDocument();
  });
});
