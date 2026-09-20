import { screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import ru from '@/shared/i18n/messages/ru.json';
import { renderWithProviders } from '@/test/utils';
import { Footer } from './footer';

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace?: string) =>
    createTranslator({ locale: 'ru', messages: ru, namespace: namespace as never }),
  getLocale: async () => 'ru',
}));

describe('Footer', async () => {
  const ui = await Footer();

  it('carries the brand lockup and the tagline', () => {
    renderWithProviders(ui);

    expect(screen.getByText('Ч')).toBeInTheDocument();
    expect(screen.getByText(/Печём большие пиццы в Махачкале с 2016 года/)).toBeInTheDocument();
  });

  it('opens the four columns of the design', () => {
    renderWithProviders(ui);

    for (const heading of ['Меню', 'Пиццерия', 'Доставка']) {
      expect(screen.getAllByText(heading).length).toBeGreaterThan(0);
    }
  });

  it('links into the menu, offers, orders and support', () => {
    renderWithProviders(ui);

    expect(screen.getByRole('link', { name: 'Меню' })).toHaveAttribute('href', '/menu');
    expect(screen.getByRole('link', { name: 'Акции' })).toHaveAttribute('href', '/#promos');
    expect(screen.getByRole('link', { name: 'Мои заказы' })).toHaveAttribute('href', '/orders');
    expect(screen.getByRole('link', { name: 'Поддержка' })).toHaveAttribute('href', '/support');
  });

  it('shows where the pizzeria is and when it works', () => {
    renderWithProviders(ui);

    expect(screen.getByText('Махачкала, пр. Расула Гамзатова, 45')).toBeInTheDocument();
    expect(screen.getByText('Ежедневно 10:00 – 23:00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Зона доставки на карте' })).toHaveAttribute('href', '/#contacts');
  });

  it('states the delivery terms that the backend actually applies', () => {
    renderWithProviders(ui);

    // The tariff is interpolated from the shared constants, so the copy can
    // never drift away from what checkout charges.
    expect(screen.getByText(/150.*по городу, бесплатно от.*1\s?000/)).toBeInTheDocument();
    expect(screen.getByText('Среднее время — 45 минут')).toBeInTheDocument();
    expect(screen.getByText('Оплата картой или наличными курьеру')).toBeInTheDocument();
  });

  it('offers a tappable phone number', () => {
    renderWithProviders(ui);

    expect(screen.getByRole('link', { name: '+7 8722 55-55-55' })).toHaveAttribute('href', 'tel:+78722555555');
  });

  it('closes with the current year and the price note', () => {
    renderWithProviders(ui);

    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()}`))).toBeInTheDocument();
    expect(screen.getByText('Цены указаны за пиццу выбранного размера')).toBeInTheDocument();
  });
});
