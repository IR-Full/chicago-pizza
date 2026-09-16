import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import type { OrderStatus } from '@/shared/api/types';
import { OrderStatusTracker } from './order-status-tracker';

const renderTracker = (status: OrderStatus) => renderWithProviders(<OrderStatusTracker status={status} />);

describe('OrderStatusTracker', () => {
  it('lists the five steps of a normal order', () => {
    renderTracker('CREATED');

    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    expect(steps.map((step) => step.textContent)).toEqual([
      'Создан',
      'Принят',
      'Готовится',
      'Передан курьеру',
      'Доставлен',
    ]);
  });

  it.each([
    ['CREATED', 'Создан'],
    ['ACCEPTED', 'Принят'],
    ['PREPARING', 'Готовится'],
    ['ON_DELIVERY', 'Передан курьеру'],
    ['DELIVERED', 'Доставлен'],
  ])('marks %s as the current step', (status, label) => {
    renderTracker(status as OrderStatus);

    const step = screen.getAllByRole('listitem').find((item) => item.textContent === label)!;

    expect(within(step).getByText(label)).toBeInTheDocument();
    expect(step.querySelector('[aria-current="step"]')).not.toBeNull();
  });

  it('marks every earlier step as done', () => {
    renderTracker('ON_DELIVERY');

    const steps = screen.getAllByRole('listitem');
    const doneCircles = steps.filter((step) => step.querySelector('.bg-primary'));

    // Created, accepted, preparing and on-delivery are behind us.
    expect(doneCircles).toHaveLength(4);
  });

  it('leaves later steps unfilled', () => {
    renderTracker('CREATED');

    const steps = screen.getAllByRole('listitem');
    const delivered = steps[4];
    expect(delivered.querySelector('.border-border')).not.toBeNull();
  });

  it('replaces the whole flow with a cancellation notice', () => {
    renderTracker('CANCELLED');

    expect(screen.getByText('Отменён')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('marks exactly one step as current', () => {
    const { container } = renderTracker('PREPARING');

    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });
});
