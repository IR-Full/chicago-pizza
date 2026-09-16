import { screen } from '@testing-library/react';
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
  productApi: { list: vi.fn(), get: vi.fn() },
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
    { id: `${id}-30`, sizeCm: 30, label: '30 см', price: 44000 },
    { id: `${id}-45`, sizeCm: 45, label: '45 см', price: 63000 },
    { id: `${id}-60`, sizeCm: 60, label: '60 см', price: 86000 },
  ],
  priceFrom: 44000,
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
  vi.mocked(productApi.get).mockImplementation(
    async (slug) =>
      ({
        id: slug,
        name: slug === 'pepperoni' ? 'Пепперони' : 'Барбекю',
        reviews: [
          {
            rating: 5,
            comment:
              slug === 'pepperoni'
                ? 'Приехало горячим, хватило на всех гостей.'
                : 'Соус барбекю именно такой, как надо, брали дважды.',
            createdAt: '2026-09-01',
          },
        ],
      }) as never,
  );
});

describe('HomePage', () => {
  it('renders the hero, the sizes and the marketing sections', async () => {
    renderWithProviders(await resolveServerTree(await HomePage()) as never);

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

  it('shows both product grids', async () => {
    renderWithProviders(await resolveServerTree(await HomePage()) as never);

    const grids = screen.getAllByTestId('grid');
    expect(grids[0]).toHaveTextContent('Пепперони, Барбекю');
    expect(grids[1]).toHaveTextContent('Цезарь');
  });

  it('drives the size scale from the real catalog prices', async () => {
    renderWithProviders(await resolveServerTree(await HomePage()) as never);

    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText(/от\s*440/)).toBeInTheDocument();
  });

  it('quotes a real review of a popular pizza', async () => {
    renderWithProviders(await resolveServerTree(await HomePage()) as never);

    expect(screen.getByText('Приехало горячим, хватило на всех гостей.')).toBeInTheDocument();
  });

  it('skips reviews that are too short to be useful', async () => {
    vi.mocked(productApi.get).mockResolvedValue({
      id: 'pepperoni',
      name: 'Пепперони',
      reviews: [{ rating: 5, comment: 'Норм', createdAt: '2026-09-01' }],
    } as never);

    renderWithProviders(await resolveServerTree(await HomePage()) as never);

    expect(screen.queryByText('Норм')).not.toBeInTheDocument();
  });

  it('still renders when the catalog is unreachable', async () => {
    vi.mocked(productApi.list).mockRejectedValue(new Error('gateway down'));
    vi.mocked(productApi.get).mockRejectedValue(new Error('gateway down'));

    renderWithProviders(await resolveServerTree(await HomePage()) as never);

    // The marketing page must not 500 because the API is having a bad day.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument();
  });

  it('ignores non-pizza products when scaling the sizes', async () => {
    vi.mocked(productApi.list).mockResolvedValue({
      items: [{ id: 'cola', name: 'Кола', type: 'DRINK', sizes: [], priceFrom: 9000, ingredients: [] }],
    } as never);

    renderWithProviders(await resolveServerTree(await HomePage()) as never);

    expect(screen.queryByText('Те самые размеры')).not.toBeInTheDocument();
  });
});
