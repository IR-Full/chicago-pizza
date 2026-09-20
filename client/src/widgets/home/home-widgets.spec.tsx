import { screen, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import ru from '@/shared/i18n/messages/ru.json';
import { renderWithProviders } from '@/test/utils';
import type { Product } from '@/shared/api/types';
import { About } from './about';
import { Contacts } from './contacts';
import { Hero } from './hero';
import { Promos } from './promos';
import { Reviews } from './reviews';
import { SizeScale } from './size-scale';

/**
 * These are server components: they resolve their copy through
 * `next-intl/server` and return a tree. Rendering the awaited result is
 * exactly what Next does, so the assertions below are on real output.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace?: string) =>
    createTranslator({ locale: 'ru', messages: ru, namespace: namespace as never }),
  getLocale: async () => 'ru',
}));

const pizza = (id: string, sizes: { sizeCm: number; price: number }[]): Product =>
  ({
    id,
    name: `Пицца ${id}`,
    slug: id,
    type: 'PIZZA',
    sizes: sizes.map((size) => ({ id: `${id}-${size.sizeCm}`, label: `${size.sizeCm} см`, ...size })),
    priceFrom: Math.min(...sizes.map((s) => s.price)),
    ingredients: [],
  }) as unknown as Product;

describe('Hero', async () => {
  const ui = await Hero();

  it('leads with the promise and the delivery badge', () => {
    renderWithProviders(ui);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('60 сантиметров семейного счастья');
    expect(screen.getByText('Махачкала · доставка за 45 минут')).toBeInTheDocument();
  });

  it('offers both calls to action', () => {
    renderWithProviders(ui);

    // The e2e smoke test looks for this link by name.
    expect(screen.getByRole('link', { name: 'Заказать' })).toHaveAttribute('href', '/menu');
    expect(screen.getByRole('link', { name: 'Сравнить размеры' })).toHaveAttribute('href', '#sizes');
  });

  it('labels the pizza image for screen readers', () => {
    renderWithProviders(ui);

    expect(screen.getByRole('img', { name: 'Пицца 60 см, вид сверху' })).toBeInTheDocument();
  });
});

describe('SizeScale', () => {
  const products = [
    pizza('pepperoni', [
      { sizeCm: 30, price: 44000 },
      { sizeCm: 45, price: 63000 },
      { sizeCm: 60, price: 86000 },
    ]),
    pizza('mushroom', [
      { sizeCm: 30, price: 41000 },
      { sizeCm: 45, price: 59000 },
      { sizeCm: 60, price: 81000 },
    ]),
  ];

  it('draws the three diameters with their labels', async () => {
    renderWithProviders((await SizeScale({ products })) as never);

    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('На всю семью')).toBeInTheDocument();
    expect(screen.getByText('16 кусков')).toBeInTheDocument();
  });

  it('quotes the cheapest price for each size across the menu', async () => {
    renderWithProviders((await SizeScale({ products })) as never);

    // Mushroom is cheaper than pepperoni at every size.
    expect(screen.getByText(/от\s*410/)).toBeInTheDocument();
    expect(screen.getByText(/от\s*590/)).toBeInTheDocument();
    expect(screen.getByText(/от\s*810/)).toBeInTheDocument();
  });

  it('scales each circle to its real diameter', async () => {
    const { container } = renderWithProviders((await SizeScale({ products })) as never);

    const circles = [...container.querySelectorAll('[style*="var(--u)"]')];
    expect(circles.map((circle) => circle.getAttribute('style'))).toEqual([
      expect.stringContaining('calc(30 * var(--u))'),
      expect.stringContaining('calc(45 * var(--u))'),
      expect.stringContaining('calc(60 * var(--u))'),
    ]);
  });

  it('sends every size through to the menu', async () => {
    renderWithProviders((await SizeScale({ products })) as never);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links.every((link) => link.getAttribute('href') === '/menu')).toBe(true);
  });

  it('renders nothing when the catalog is unavailable', async () => {
    const { container } = renderWithProviders(((await SizeScale({ products: [] })) ?? <div data-empty />) as never);

    expect(container.querySelector('#sizes')).toBeNull();
  });

  it('ignores a diameter the design has no tone for', async () => {
    renderWithProviders((await SizeScale({ products: [pizza('mini', [{ sizeCm: 25, price: 30000 }])] })) as never);

    expect(screen.queryByText('25')).not.toBeInTheDocument();
  });
});

describe('Promos', async () => {
  const ui = await Promos();

  it('shows the three standing offers', () => {
    renderWithProviders(ui);

    expect(screen.getByText('Бесплатная доставка')).toBeInTheDocument();
    expect(screen.getByText('Кэшбэк баллами')).toBeInTheDocument();
    expect(screen.getByText('Приведи друга')).toBeInTheDocument();
  });

  it('quotes the same numbers the backend actually applies', () => {
    renderWithProviders(ui);

    expect(screen.getByText('0 ₽')).toBeInTheDocument();
    expect(screen.getByText('до 10%')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
  });

  it('anchors the section so the nav can jump to it', () => {
    const { container } = renderWithProviders(ui);

    expect(container.querySelector('#promos')).not.toBeNull();
  });
});

describe('About', async () => {
  const ui = await About();

  it('tells the story and the three facts', () => {
    renderWithProviders(ui);

    expect(screen.getByRole('heading', { name: /Пиццу мы меряем/ })).toBeInTheDocument();
    expect(screen.getByText('2016')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('labels each fact for screen readers', () => {
    renderWithProviders(ui);

    expect(screen.getByText('год открытия')).toBeInTheDocument();
    expect(screen.getByText('минут в среднем')).toBeInTheDocument();
    expect(screen.getByText('размера пиццы')).toBeInTheDocument();
  });
});

describe('Contacts', async () => {
  const ui = await Contacts();

  it('lists address, phone, hours and delivery terms', () => {
    renderWithProviders(ui);

    expect(screen.getByText('Махачкала, пр. Расула Гамзатова, 45')).toBeInTheDocument();
    expect(screen.getByText('Ежедневно 10:00 – 23:00')).toBeInTheDocument();
    expect(screen.getByText('150 ₽ по городу, бесплатно от 1000 ₽')).toBeInTheDocument();
  });

  it('offers a call and a way into the menu', () => {
    renderWithProviders(ui);

    expect(screen.getByRole('link', { name: '+7 8722 55-55-55' })).toHaveAttribute('href', 'tel:+78722555555');
    expect(screen.getByRole('link', { name: 'Заказать доставку' })).toHaveAttribute('href', '/menu');
  });

  it('anchors the section for the nav', () => {
    const { container } = renderWithProviders(ui);

    expect(container.querySelector('#contacts')).not.toBeNull();
  });
});

describe('Reviews', () => {
  const REVIEW = {
    id: 'rev-1',
    comment: 'Приехало горячим, хватило на шестерых гостей.',
    rating: 5,
    createdAt: '2026-09-01T12:00:00.000Z',
    authorName: 'Марьям',
    items: ['Пепперони', 'Кола'],
  };

  it('quotes a real review with its author and rating', async () => {
    renderWithProviders((await Reviews({ reviews: [REVIEW] })) as never);

    expect(screen.getByText(REVIEW.comment)).toBeInTheDocument();
    const caption = screen.getByText(/Марьям/);
    expect(within(caption).getByLabelText('5 / 5')).toBeInTheDocument();
  });

  it('names what was in the order, capped at two items', async () => {
    renderWithProviders(
      (await Reviews({ reviews: [{ ...REVIEW, items: ['Пепперони', 'Кола', 'Соус'] }] })) as never,
    );

    // A review rates the whole order; the caption lists it without turning
    // into a receipt.
    const caption = screen.getByText(/Пепперони, Кола/);
    expect(caption.textContent).not.toContain('Соус');
  });

  it('survives an order with no item names', async () => {
    renderWithProviders((await Reviews({ reviews: [{ ...REVIEW, items: [] }] })) as never);

    expect(screen.getByText(/Марьям/)).toBeInTheDocument();
  });

  it('renders one figure per review', async () => {
    const { container } = renderWithProviders(
      (await Reviews({ reviews: [REVIEW, { ...REVIEW, id: 'rev-2', rating: 4 }] })) as never,
    );

    expect(container.querySelectorAll('figure')).toHaveLength(2);
  });

  it('hides itself when there are no reviews, rather than inventing any', async () => {
    expect(await Reviews({ reviews: [] })).toBeNull();
  });
});
