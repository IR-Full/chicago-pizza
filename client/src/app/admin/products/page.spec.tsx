import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { adminApi } from '@/features/admin/api';
import { slugify } from '@/features/admin/slugify';
import AdminProductsPage from './page';

/**
 * The panel had no way to touch a product at all: the menu was whatever the
 * seed script had written. So a new drink meant a developer and a deploy — and
 * the flavours a product is sold in, which the constructor asks about and the
 * kitchen ticket prints, were settable *only* by re-running the seed.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/admin/api', () => ({
  adminApi: { listProducts: vi.fn(), updateProduct: vi.fn(), deleteProduct: vi.fn() },
}));
vi.mock('@/entities/product/queries', () => ({
  useCategories: () => ({ data: [{ id: 'c1', name: 'Напитки' }] }),
}));

const KINZA = {
  id: 'p-kinza',
  name: 'Kinza',
  slug: 'kinza',
  description: 'Шесть вкусов на выбор',
  imageUrl: null,
  type: 'DRINK',
  categoryId: 'c1',
  category: { id: 'c1', name: 'Напитки', slug: 'drinks' },
  isActive: true,
  isAvailable: true,
  stoppedUntil: null,
  isVegetarian: true,
  isSpicy: false,
  isHalal: false,
  isNew: false,
  isPopular: false,
  basePrice: 13000,
  priceFrom: 13000,
  sizes: [],
  ingredients: [],
  variants: [
    { id: 'v1', name: 'Кола', slug: 'cola' },
    { id: 'v2', name: 'Лимон', slug: 'lemon' },
  ],
};

const PIZZA = {
  ...KINZA,
  id: 'p-pepperoni',
  name: 'Пепперони',
  slug: 'pepperoni',
  type: 'PIZZA',
  basePrice: 0,
  priceFrom: 44000,
  sizes: [{ id: 's30', sizeCm: 30, label: '30 см', price: 44000 }],
  variants: [],
};

const page = (items: Record<string, unknown>[]) => ({
  items,
  total: items.length,
  page: 1,
  limit: 50,
  totalPages: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.listProducts).mockResolvedValue(page([KINZA, PIZZA]) as never);
  vi.mocked(adminApi.updateProduct).mockResolvedValue(KINZA as never);
  vi.mocked(adminApi.deleteProduct).mockResolvedValue({ success: true } as never);
});

/** Opens the editor on one product and waits for the form to be seeded. */
async function openEditor(name: string) {
  renderWithProviders(<AdminProductsPage />);
  // By the row's own button, not the first one on the page: every row has an
  // "Изменить" and they are told apart by the product they name.
  fireEvent.click(await screen.findByRole('button', { name: `Изменить «${name}»` }));
  await screen.findByLabelText('Название');
}

describe('AdminProductsPage — the list', () => {
  it('shows the menu, flavour counts included', async () => {
    renderWithProviders(<AdminProductsPage />);

    expect(await screen.findByText('Kinza')).toBeInTheDocument();
    expect(screen.getByText(/2 вкусов/)).toBeInTheDocument();
  });

  /**
   * The item taken off the menu is the one most likely to need editing — it
   * cannot be put back from a list that hides everything inactive.
   */
  it('marks a delisted product rather than hiding it', async () => {
    vi.mocked(adminApi.listProducts).mockResolvedValue(page([{ ...KINZA, isActive: false }]) as never);
    renderWithProviders(<AdminProductsPage />);

    expect(await screen.findByText('Снят с продажи')).toBeInTheDocument();
  });

  it('offers no "delist" button for something already off the menu', async () => {
    vi.mocked(adminApi.listProducts).mockResolvedValue(page([{ ...KINZA, isActive: false }]) as never);
    renderWithProviders(<AdminProductsPage />);

    await screen.findByText('Kinza');
    expect(screen.queryByRole('button', { name: /Снять «Kinza»/ })).not.toBeInTheDocument();
  });

  it('narrows by search and returns to the first page', async () => {
    renderWithProviders(<AdminProductsPage />);
    await screen.findByText('Kinza');

    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'kinza' } });

    await waitFor(() => expect(adminApi.listProducts).toHaveBeenCalledWith(1, 'kinza', 50));
  });
});

describe('AdminProductsPage — editing flavours', () => {
  it('seeds the form with the flavours the product already has', async () => {
    await openEditor('Kinza');

    expect(screen.getByLabelText('Название вкуса 1')).toHaveValue('Кола');
    expect(screen.getByLabelText('Название вкуса 2')).toHaveValue('Лимон');
  });

  it('saves a flavour that was added, numbered in menu order', async () => {
    await openEditor('Kinza');

    fireEvent.click(screen.getByRole('button', { name: 'Добавить вкус' }));
    fireEvent.change(screen.getByLabelText('Название вкуса 3'), { target: { value: 'Гранат' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(adminApi.updateProduct).toHaveBeenCalledWith(
        'p-kinza',
        expect.objectContaining({
          variants: [
            { name: 'Кола', slug: 'cola', sortOrder: 0 },
            { name: 'Лимон', slug: 'lemon', sortOrder: 1 },
            { name: 'Гранат', slug: 'granat', sortOrder: 2 },
          ],
        }),
      ),
    );
  });

  it('removes a flavour', async () => {
    await openEditor('Kinza');

    fireEvent.click(screen.getByRole('button', { name: 'Убрать вкус Лимон' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(adminApi.updateProduct).toHaveBeenCalledWith(
        'p-kinza',
        expect.objectContaining({ variants: [{ name: 'Кола', slug: 'cola', sortOrder: 0 }] }),
      ),
    );
  });

  /**
   * An omitted `variants` means "leave them alone" on the server and `[]` means
   * "this product has none" — so clearing the last flavour has to send the empty
   * array, not nothing.
   */
  it('sends an empty list when every flavour is removed', async () => {
    await openEditor('Kinza');

    fireEvent.click(screen.getByRole('button', { name: 'Убрать вкус Кола' }));
    fireEvent.click(screen.getByRole('button', { name: 'Убрать вкус Лимон' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(adminApi.updateProduct).toHaveBeenCalledWith(
        'p-kinza',
        expect.objectContaining({ variants: [] }),
      ),
    );
  });

  it('does not save a half-typed flavour row', async () => {
    await openEditor('Kinza');

    // Added and left blank — the admin changed their mind.
    fireEvent.click(screen.getByRole('button', { name: 'Добавить вкус' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(adminApi.updateProduct).toHaveBeenCalled());
    const sent = vi.mocked(adminApi.updateProduct).mock.calls[0][1] as { variants: unknown[] };
    expect(sent.variants).toHaveLength(2);
  });
});

describe('AdminProductsPage — editing the rest', () => {
  it('sends the price in kopecks, not roubles', async () => {
    await openEditor('Kinza');

    fireEvent.change(screen.getByLabelText('Цена, ₽'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(adminApi.updateProduct).toHaveBeenCalledWith(
        'p-kinza',
        expect.objectContaining({ basePrice: 15000 }),
      ),
    );
  });

  /** A pizza's price lives on its sizes, which this screen does not edit. */
  it('will not let a pizza’s base price be typed', async () => {
    vi.mocked(adminApi.listProducts).mockResolvedValue(page([PIZZA]) as never);
    await openEditor('Пепперони');

    expect(screen.getByLabelText('Цена, ₽')).toBeDisabled();
    expect(screen.getByText('У пиццы цена задаётся по размерам')).toBeInTheDocument();
  });

  it('puts a delisted product back on sale', async () => {
    vi.mocked(adminApi.listProducts).mockResolvedValue(page([{ ...KINZA, isActive: false }]) as never);
    await openEditor('Kinza');

    fireEvent.click(screen.getByLabelText('В продаже'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(adminApi.updateProduct).toHaveBeenCalledWith(
        'p-kinza',
        expect.objectContaining({ isActive: true }),
      ),
    );
  });

  it('refuses to save a product with no name', async () => {
    await openEditor('Kinza');

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: '  ' } });

    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('reports a refusal from the server', async () => {
    const { toast } = await import('sonner');
    vi.mocked(adminApi.updateProduct).mockRejectedValue(new Error('nope'));
    await openEditor('Kinza');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

/**
 * The slug is half of the key a flavour is stored under, so it has to exist and
 * be stable — but nobody should have to type "lime-mint" next to "Лайм-мята".
 */
describe('slugify', () => {
  it.each([
    ['Кола', 'kola'],
    ['Лайм-мята', 'laym-myata'],
    ['Апельсин', 'apelsin'],
    ['Lemon', 'lemon'],
    ['  Двойной  пробел ', 'dvoynoy-probel'],
  ])('turns %s into %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('keeps a hand-edited slug once it stops matching the name', async () => {
    await openEditor('Kinza');

    const slug = screen.getByLabelText('Slug вкуса 1');
    fireEvent.change(slug, { target: { value: 'cola-zero' } });
    // The name changes afterwards; the slug must not follow it any more.
    fireEvent.change(screen.getByLabelText('Название вкуса 1'), { target: { value: 'Кола Зеро' } });

    expect(slug).toHaveValue('cola-zero');
  });
});
