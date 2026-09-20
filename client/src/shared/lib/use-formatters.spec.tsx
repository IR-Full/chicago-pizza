import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import en from '@/shared/i18n/messages/en.json';
import { renderWithProviders } from '@/test/utils';
import { useFormatters } from './use-formatters';

function Probe() {
  const { formatPrice, formatDateTime, formatTime } = useFormatters();
  return (
    <>
      <span data-testid="price">{formatPrice(63000)}</span>
      <span data-testid="date">{formatDateTime('2026-09-16T10:30:00.000Z')}</span>
      <span data-testid="time">{formatTime('2026-09-16T10:30:00.000Z')}</span>
    </>
  );
}

/**
 * The helpers used to default to `ru-RU` and nobody ever passed a locale, so
 * the English site printed Russian month names and number grouping.
 */
describe('useFormatters', () => {
  it('formats in Russian for a Russian visitor', () => {
    renderWithProviders(<Probe />);

    expect(screen.getByTestId('price').textContent).toContain('630');
    expect(screen.getByTestId('date').textContent).toMatch(/сентября/);
  });

  it('follows the visitor to English', () => {
    renderWithProviders(<Probe />, { locale: 'en', messages: en });

    expect(screen.getByTestId('date').textContent).toMatch(/September/);
    expect(screen.getByTestId('date').textContent).not.toMatch(/сентября/);
  });

  it('keeps roubles as the currency in either language', () => {
    // The pizzeria charges roubles regardless of the interface language.
    renderWithProviders(<Probe />, { locale: 'en', messages: en });

    expect(screen.getByTestId('price').textContent).toMatch(/RUB|₽/);
    expect(screen.getByTestId('price').textContent).toContain('630');
  });

  it('renders a bare time without the date', () => {
    renderWithProviders(<Probe />);

    expect(screen.getByTestId('time').textContent).toMatch(/^\d{2}:\d{2}$/);
  });
});
