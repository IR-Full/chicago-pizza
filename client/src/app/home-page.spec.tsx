import { screen, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/shared/i18n/messages/ru.json';
import { renderWithProviders, resolveServerTree } from '@/test/utils';
import { productApi } from '@/entities/product/api';
import HomePage from './page';

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace?: string) =>
    createTranslator({ locale: 'ru', messages: ru, namespace: namespace as never }),
  getLocale: async () => 'ru',
}));

vi.mock('@/entities/product/api', () => ({
  productApi: { list: vi.fn(), get: vi.fn(), recentReviews: vi.fn(), branches: vi.fn() },
}));

// The grid is a client island with its own spec.
vi.mock('@/widgets/home/home-product-grid', () => ({
  HomeProductGrid: ({ products }: { products: { id: string; name: string }[] }) => (
    <div data-testid="grid">{products.map((p) => p.name).join(', ')}</div>
  ),
}));

const pizza = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  slug: id,
  type: 'PIZZA',
  sizes: [
    { id: `${id}-45`, sizeCm: 45, label: '45 см', price: 75000 },
    { id: `${id}-50`, sizeCm: 50, label: '50 см', price: 95000 },
    { id: `${id}-60`, sizeCm: 60, label: '60 см', price: 135000 },
  ],
  priceFrom: 75000,
  ingredients: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productApi.list).mockImplementation(async (filters) =>
    filters?.isNew
      ? ({ items: [pizza('caesar', 'Цезарь')] } as never)
      : ({ items: [pizza('pepperoni', 'Пепперони'), pizza('bbq', 'Барбекю')] } as never),
  );
  vi.mocked(productApi.branches).mockResolvedValue([
    {
      id: 'branch-1',
      name: 'Chicago Pizza на Гамзатова',
      slug: 'gamzatova',
      address: 'Махачкала, пр. Расула Гамзатова, 45',
      lat: 42.9764,
      lng: 47.5024,
      phone: '+7 8722 55-55-55',
      openMinute: 690,
      closeMinute: 1410,
    },
  ] as never);
  vi.mocked(productApi.recentReviews).mockResolvedValue([
    {
      id: 'rev-1',
      rating: 5,
      comment: 'Приехало горячим, хватило на всех гостей.',
      createdAt: '2026-09-01T10:00:00.000Z',
      authorName: 'Марьям',
      items: ['Пепперони'],
    },
  ]);
});

describe('HomePage', () => {
  it('renders the hero, the sizes and the marketing sections', async () => {
    renderWithProviders((await resolveServerTree(await HomePage())) as never);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('60 сантиметров семейного счастья');
    expect(screen.getByText('Те самые размеры')).toBeInTheDocument();
    expect(screen.getByText('Маленькие поводы заказать побольше')).toBeInTheDocument();
    expect(screen.getByText('Заходите или закажите домой')).toBeInTheDocument();
  });

  it('asks for the popular and the new products', async () => {
    await HomePage();

    expect(productApi.list).toHaveBeenCalledWith({ isPopular: true, limit: 8 });
    expect(productApi.list).toHaveBeenCalledWith({ isNew: true, limit: 4 });
  });

  it('asks the reviews endpoint once instead of walking the popular pizzas', async () => {
    await HomePage();

    // Used to be one `productApi.get` per popular pizza — three extra
    // round-trips for three quotes.
    expect(productApi.recentReviews).toHaveBeenCalledTimes(1);
    expect(productApi.recentReviews).toHaveBeenCalledWith(3);
    expect(productApi.get).not.toHaveBeenCalled();
  });

  it('shows both product grids', async () => {
    renderWithProviders((await resolveServerTree(await HomePage())) as never);

    const grids = screen.getAllByTestId('grid');
    expect(grids[0]).toHaveTextContent('Пепперони, Барбекю');
    expect(grids[1]).toHaveTextContent('Цезарь');
  });

  it('drives the size scale from the real catalog prices', async () => {
    const { container } = renderWithProviders((await resolveServerTree(await HomePage())) as never);

    // Scoped to the size section rather than the whole page: "45" is also the
    // "45 минут" delivery stat further down, so a page-wide `getByText('45')`
    // matches two elements and throws. It only started colliding when the
    // smallest pizza became 45 cm.
    const scale = container.querySelector('#sizes')!;
    expect(scale).toBeTruthy();

    const diameters = [...scale.querySelectorAll('[style*="var(--u)"]')].map((el) =>
      el.textContent?.replace(/\D/g, ''),
    );
    expect(diameters).toEqual(['45', '50', '60']);

    // Cheapest 45 cm pizza in the fixture catalogue, as the section's own
    // "от N" line.
    expect(within(scale as HTMLElement).getByText(/от\s*750/)).toBeInTheDocument();
  });

  it('quotes a real review of a delivered order', async () => {
    renderWithProviders((await resolveServerTree(await HomePage())) as never);

    expect(screen.getByText('Приехало горячим, хватило на всех гостей.')).toBeInTheDocument();
    expect(screen.getByText(/Марьям/)).toBeInTheDocument();
  });

  it('hides the section when there are no reviews yet', async () => {
    vi.mocked(productApi.branches).mockResolvedValue([
      {
        id: 'branch-1',
        name: 'Chicago Pizza на Гамзатова',
        slug: 'gamzatova',
        address: 'Махачкала, пр. Расула Гамзатова, 45',
        lat: 42.9764,
        lng: 47.5024,
        phone: '+7 8722 55-55-55',
        openMinute: 690,
        closeMinute: 1410,
      },
    ] as never);
    vi.mocked(productApi.recentReviews).mockResolvedValue([]);

    renderWithProviders((await resolveServerTree(await HomePage())) as never);

    expect(screen.queryByText('Отзывы')).not.toBeInTheDocument();
  });

  it('still renders when the catalog is unreachable', async () => {
    vi.mocked(productApi.list).mockRejectedValue(new Error('gateway down'));
    vi.mocked(productApi.recentReviews).mockRejectedValue(new Error('gateway down'));

    renderWithProviders((await resolveServerTree(await HomePage())) as never);

    // The marketing page must not 500 because the API is having a bad day.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument();
  });

  it('ignores non-pizza products when scaling the sizes', async () => {
    vi.mocked(productApi.list).mockResolvedValue({
      items: [{ id: 'cola', name: 'Кола', type: 'DRINK', sizes: [], priceFrom: 9000, ingredients: [] }],
    } as never);

    renderWithProviders((await resolveServerTree(await HomePage())) as never);

    expect(screen.queryByText('Те самые размеры')).not.toBeInTheDocument();
  });
});

/**
 * The contacts block used to quote a hardcoded address, which could not
 * survive opening a second kitchen — and this is exactly the section a
 * customer reads to find the one nearest them.
 */
describe('HomePage — the chain’s kitchens', () => {
  it('lists every branch with its own phone and hours', async () => {
    vi.mocked(productApi.branches).mockResolvedValue([
      {
        id: 'branch-1',
        name: 'Chicago Pizza на Гамзатова',
        address: 'Махачкала, пр. Расула Гамзатова, 45',
        phone: '+7 8722 55-55-55',
        openMinute: 690,
        closeMinute: 1410,
      },
      {
        id: 'branch-2',
        name: 'Chicago Pizza на Акушинского',
        address: 'Махачкала, пр. Акушинского, 90',
        phone: '+7 8722 55-55-56',
        openMinute: 690,
        closeMinute: 1410,
      },
    ] as never);

    renderWithProviders((await resolveServerTree(await HomePage())) as never);

    expect(screen.getByText('Chicago Pizza на Гамзатова')).toBeInTheDocument();
    expect(screen.getByText(/пр. Акушинского, 90/)).toBeInTheDocument();
    expect(screen.getByText(/55-55-56/)).toBeInTheDocument();
  });

  it('names the flagship branch in the structured data', async () => {
    const { container } = renderWithProviders((await resolveServerTree(await HomePage())) as never);

    const script = container.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script!.innerHTML);

    expect(data).toMatchObject({
      '@type': 'Restaurant',
      telephone: '+7 8722 55-55-55',
      address: expect.objectContaining({ streetAddress: 'Махачкала, пр. Расула Гамзатова, 45' }),
    });
  });

  it('still renders when the branch list cannot be fetched', async () => {
    vi.mocked(productApi.branches).mockRejectedValue(new Error('gateway down'));

    // A broken branch list must not take the home page down with it.
    renderWithProviders((await resolveServerTree(await HomePage())) as never);

    expect(screen.getByText('Доставка')).toBeInTheDocument();
  });
});
