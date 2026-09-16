import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import type { CartLine } from '@/shared/api/types';
import { CartLineItem } from './cart-line-item';

const LINE = {
  lineId: 'l1',
  productId: 'p1',
  productName: 'Пепперони',
  sizeLabel: '45 см',
  doughTypeId: 'd1',
  doughTypeName: 'Тонкое',
  secondHalfProductId: null,
  secondHalfName: null,
  addedIngredients: [],
  removedIngredients: [],
  unitPrice: 63000,
  quantity: 1,
  totalPrice: 63000,
  imageUrl: null,
} as unknown as CartLine;

function renderLine(line: Partial<CartLine> = {}, props: Record<string, unknown> = {}) {
  const onQuantityChange = vi.fn();
  const onRemove = vi.fn();
  const view = renderWithProviders(
    <ul>
      <CartLineItem
        line={{ ...LINE, ...line } as CartLine}
        onQuantityChange={onQuantityChange}
        onRemove={onRemove}
        {...props}
      />
    </ul>,
  );
  return { ...view, onQuantityChange, onRemove };
}

describe('CartLineItem', () => {
  it('shows the product, its size and dough', () => {
    renderLine();

    expect(screen.getByText('Пепперони')).toBeInTheDocument();
    expect(screen.getByText('45 см · Тонкое тесто')).toBeInTheDocument();
  });

  it('omits the dough part when there is none', () => {
    renderLine({ doughTypeName: null });

    expect(screen.getByText('45 см')).toBeInTheDocument();
  });

  it('lists added ingredients with a plus', () => {
    renderLine({ addedIngredients: [{ id: 'i1', name: 'Бекон', price: 11000 }] as never });

    expect(screen.getByText('+ Бекон')).toBeInTheDocument();
  });

  it('strikes through removed ingredients', () => {
    renderLine({ removedIngredients: [{ id: 'i2', name: 'Лук' }] as never });

    expect(screen.getByText('Лук')).toHaveClass('line-through');
  });

  it('shows the line total', () => {
    renderLine();

    expect(screen.getByText(/630/)).toBeInTheDocument();
  });

  it('breaks the total down only when more than one is ordered', () => {
    const { unmount } = renderLine();
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
    unmount();

    renderLine({ quantity: 3, totalPrice: 189000 });
    expect(screen.getByText(/× 3/)).toBeInTheDocument();
  });

  it('increments and decrements through the callback', () => {
    const { onQuantityChange } = renderLine({ quantity: 2 });

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByRole('button', { name: '-' }));

    expect(onQuantityChange).toHaveBeenNthCalledWith(1, 'l1', 3);
    expect(onQuantityChange).toHaveBeenNthCalledWith(2, 'l1', 1);
  });

  it('asks to remove the line', () => {
    const { onRemove } = renderLine();

    fireEvent.click(screen.getByRole('button', { name: 'Корзина' }));

    expect(onRemove).toHaveBeenCalledWith('l1');
  });

  it('decrementing from one asks for zero, which the cart treats as a removal', () => {
    const { onQuantityChange } = renderLine({ quantity: 1 });

    fireEvent.click(screen.getByRole('button', { name: '-' }));

    expect(onQuantityChange).toHaveBeenCalledWith('l1', 0);
  });

  it('locks every control while a mutation is in flight', () => {
    renderLine({}, { disabled: true });

    for (const name of ['+', '-', 'Корзина']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('falls back to an emoji without a photo, and renders one when present', () => {
    const { unmount } = renderLine();
    expect(screen.getByText('🍕')).toBeInTheDocument();
    unmount();

    const { container } = renderLine({ imageUrl: 'https://cdn.example/p.jpg' });
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/p.jpg');
  });
});
