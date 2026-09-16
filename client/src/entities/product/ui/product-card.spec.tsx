import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import type { Product } from '@/shared/api/types';
import { ProductCard } from './product-card';

const PIZZA = {
  id: 'p1',
  name: 'Пепперони',
  slug: 'pepperoni',
  description: 'Острая пепперони и моцарелла на пикантном томатном соусе',
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

const DRINK = { ...PIZZA, id: 'd1', name: 'Кола', type: 'DRINK', isSpicy: false, priceFrom: 9000 } as Product;

const renderCard = (product: Product = PIZZA, props: Record<string, unknown> = {}) => {
  const onSelect = vi.fn();
  const view = renderWithProviders(<ProductCard product={product} onSelect={onSelect} {...props} />);
  return { ...view, onSelect };
};

describe('ProductCard', () => {
  it('shows the name, description and starting price', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Пепперони' })).toBeInTheDocument();
    expect(screen.getByText(/Острая пепперони/)).toBeInTheDocument();
    expect(screen.getByText(/440/)).toBeInTheDocument();
  });

  it('prefixes a pizza price with "от", since the size decides the real price', () => {
    renderCard();

    expect(screen.getByText('от')).toBeInTheDocument();
  });

  it('shows a flat price for a simple product', () => {
    renderCard(DRINK);

    expect(screen.queryByText('от')).not.toBeInTheDocument();
  });

  it('invites a pizza to be configured and a drink straight into the cart', () => {
    const { onSelect, unmount } = renderCard();
    expect(screen.getByRole('button', { name: 'Собрать' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Собрать' }));
    expect(onSelect).toHaveBeenCalledWith(PIZZA);
    unmount();

    renderCard(DRINK);
    expect(screen.getByRole('button', { name: 'В корзину' })).toBeInTheDocument();
  });

  it.each([
    ['isNew', 'Новинки'],
    ['isSpicy', 'Острое'],
    ['isVegetarian', 'Вегетарианское'],
  ])('shows the %s tag', (flag, label) => {
    renderCard({ ...PIZZA, isNew: false, isSpicy: false, isVegetarian: false, [flag]: true } as Product);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('keeps the tag row in place for an untagged product so titles line up', () => {
    const { container } = renderCard({
      ...PIZZA,
      isNew: false,
      isSpicy: false,
      isVegetarian: false,
    } as Product);

    expect(container.querySelector('.min-h-\\[22px\\]')).toBeInTheDocument();
  });

  it('falls back to an emoji when there is no photo', () => {
    renderCard();

    expect(screen.getByText('🍕')).toBeInTheDocument();
  });

  it('renders the photo when there is one', () => {
    renderCard({ ...PIZZA, imageUrl: 'https://cdn.example/pepperoni.jpg' } as Product);

    const image = screen.getByAltText('Пепперони');
    expect(image).toHaveAttribute('src', 'https://cdn.example/pepperoni.jpg');
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  it('serves the product on a round plate, per the design', () => {
    const { container } = renderCard();

    expect(container.querySelector('figure')).toHaveClass('rounded-full');
  });

  it('hides the favorite control for a guest', () => {
    renderCard();

    expect(screen.queryByRole('button', { name: 'Пепперони' })).not.toBeInTheDocument();
  });

  it('toggles a favorite for a signed-in customer', () => {
    const onToggleFavorite = vi.fn();
    renderCard(PIZZA, { showFavorite: true, onToggleFavorite });

    const button = screen.getByRole('button', { name: 'Пепперони' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);
    expect(onToggleFavorite).toHaveBeenCalledWith(PIZZA);
  });

  it('marks an existing favorite as pressed', () => {
    renderCard(PIZZA, { showFavorite: true, onToggleFavorite: vi.fn(), isFavorite: true });

    expect(screen.getByRole('button', { name: 'Пепперони' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders a product without a description', () => {
    renderCard({ ...PIZZA, description: null } as Product);

    expect(screen.getByRole('heading', { name: 'Пепперони' })).toBeInTheDocument();
  });
});
