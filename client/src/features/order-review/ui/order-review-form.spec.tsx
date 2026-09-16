import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import { OrderReviewForm } from './order-review-form';

const submitReview = { mutateAsync: vi.fn(), isPending: false };
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a) },
}));
vi.mock('@/entities/order/queries', () => ({ useSubmitReview: () => submitReview }));

beforeEach(() => {
  vi.clearAllMocks();
  submitReview.mutateAsync.mockResolvedValue({ rating: 5, comment: null });
});

const render = (existingReview: { rating: number; comment: string | null } | null = null) =>
  renderWithProviders(<OrderReviewForm orderId="order-1" existingReview={existingReview} />);

describe('OrderReviewForm', () => {
  it('offers five stars and blocks submission until one is chosen', () => {
    render();

    expect(screen.getAllByRole('button', { name: /^[1-5]$/ })).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Отправить отзыв' })).toBeDisabled();
  });

  it('submits the chosen rating', async () => {
    render();

    fireEvent.click(screen.getByRole('button', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить отзыв' }));

    await waitFor(() =>
      expect(submitReview.mutateAsync).toHaveBeenCalledWith({ id: 'order-1', rating: 4, comment: undefined }),
    );
    expect(toast.success).toHaveBeenCalledWith('Спасибо за отзыв!');
  });

  it('submits a comment alongside the rating', async () => {
    render();

    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Тесто отличное' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить отзыв' }));

    await waitFor(() =>
      expect(submitReview.mutateAsync).toHaveBeenCalledWith({
        id: 'order-1',
        rating: 5,
        comment: 'Тесто отличное',
      }),
    );
  });

  it('fills the stars up to the chosen rating', () => {
    const { container } = render();

    fireEvent.click(screen.getByRole('button', { name: '3' }));

    expect(container.querySelectorAll('.fill-brand-500')).toHaveLength(3);
  });

  it('previews a rating on hover and restores it on leave', () => {
    const { container } = render();

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.mouseEnter(screen.getByRole('button', { name: '5' }));
    expect(container.querySelectorAll('.fill-brand-500')).toHaveLength(5);

    fireEvent.mouseLeave(container.querySelector('.flex.gap-1')!);
    expect(container.querySelectorAll('.fill-brand-500')).toHaveLength(2);
  });

  it('starts from an existing review so it can be revised', () => {
    const { container } = render({ rating: 4, comment: 'Было вкусно' });

    expect(container.querySelectorAll('.fill-brand-500')).toHaveLength(4);
    expect(screen.getByRole('textbox')).toHaveValue('Было вкусно');
    expect(screen.getByRole('button', { name: 'Отправить отзыв' })).toBeEnabled();
  });

  it('handles an existing review with no comment', () => {
    render({ rating: 5, comment: null });

    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('reports a server refusal', async () => {
    submitReview.mutateAsync.mockRejectedValue(new ApiError('Оценить можно только доставленный заказ', 400));
    render();

    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить отзыв' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Оценить можно только доставленный заказ'));
  });

  it('falls back to a generic message on an unexpected failure', async () => {
    submitReview.mutateAsync.mockRejectedValue(new Error('offline'));
    render();

    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отправить отзыв' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Не удалось отправить отзыв'));
  });
});
