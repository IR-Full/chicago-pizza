import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { Pagination } from './pagination';

describe('Pagination', () => {
  it('stays out of the way when everything fits on one page', () => {
    const { container } = renderWithProviders(
      <Pagination page={1} totalPages={1} onChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('announces the position', () => {
    renderWithProviders(<Pagination page={2} totalPages={5} onChange={vi.fn()} />);

    expect(screen.getByText('Страница 2 из 5')).toBeInTheDocument();
  });

  it('steps forward and back', () => {
    const onChange = vi.fn();
    renderWithProviders(<Pagination page={3} totalPages={5} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая страница' }));

    expect(onChange).toHaveBeenNthCalledWith(1, 4);
    expect(onChange).toHaveBeenNthCalledWith(2, 2);
  });

  it('cannot walk off either end', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <Pagination page={1} totalPages={3} onChange={onChange} />,
    );

    expect(screen.getByRole('button', { name: 'Предыдущая страница' })).toBeDisabled();

    rerender(<Pagination page={3} totalPages={3} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeDisabled();
  });

  it('clamps a page number that is out of range instead of rendering nonsense', () => {
    const onChange = vi.fn();
    // A filter change can leave a stale page number behind for one render.
    renderWithProviders(<Pagination page={99} totalPages={4} onChange={onChange} />);

    expect(screen.getByText('Страница 4 из 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeDisabled();
  });

  it('labels itself for screen readers', () => {
    renderWithProviders(<Pagination page={1} totalPages={2} onChange={vi.fn()} />);

    expect(screen.getByRole('navigation', { name: 'Страницы' })).toBeInTheDocument();
  });
});
