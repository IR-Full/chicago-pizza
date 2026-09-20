import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import PrivacyPage from '@/app/privacy/page';
import TermsPage from '@/app/terms/page';
import { PRIVACY_POLICY_VERSION } from '@/shared/config/legal';
import { CookieNotice } from './cookie-notice';

describe('CookieNotice', () => {
  beforeEach(() => window.localStorage.clear());

  it('tells the visitor what is actually set, without pretending to ask', () => {
    renderWithProviders(<CookieNotice />);

    // Strictly necessary cookies need no prior consent; a modal demanding
    // "accept" for cookies that are set anyway would be theatre.
    expect(screen.getByText(/технически необходимые куки/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Отклонить/ })).not.toBeInTheDocument();
  });

  it('links to the policy that explains them', () => {
    renderWithProviders(<CookieNotice />);

    expect(screen.getByRole('link', { name: 'Подробнее' })).toHaveAttribute('href', '/privacy');
  });

  it('stays dismissed across visits', () => {
    const { unmount } = renderWithProviders(<CookieNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    expect(screen.queryByText(/технически необходимые куки/)).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<CookieNotice />);
    expect(screen.queryByText(/технически необходимые куки/)).not.toBeInTheDocument();
  });

  it('records the dismissal outside cookies, so the notice is not its own subject', () => {
    renderWithProviders(<CookieNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));

    expect(window.localStorage.getItem('cookie-notice-dismissed')).toBe('1');
    expect(document.cookie).not.toContain('cookie-notice');
  });
});

describe('PrivacyPage', () => {
  it('states the version an account can be checked against', () => {
    renderWithProviders(<PrivacyPage />);

    // The server stores which version a customer accepted; a policy with no
    // version cannot be matched against it.
    expect(screen.getByText(new RegExp(PRIVACY_POLICY_VERSION))).toBeInTheDocument();
  });

  it('names the law it answers to and the rights that follow from it', () => {
    renderWithProviders(<PrivacyPage />);

    expect(screen.getByText(/152-ФЗ/)).toBeInTheDocument();
    expect(screen.getByText(/Скачать мои данные/)).toBeInTheDocument();
    expect(screen.getByText(/Удалить аккаунт/)).toBeInTheDocument();
  });

  it('is honest that IP addresses are collected', () => {
    renderWithProviders(<PrivacyPage />);

    expect(screen.getByText(/IP-адрес/)).toBeInTheDocument();
  });
});

describe('TermsPage', () => {
  it('states the delivery terms the checkout actually charges', () => {
    renderWithProviders(<TermsPage />);

    expect(screen.getByText(/150 ₽/)).toBeInTheDocument();
    expect(screen.getByText(/1000 ₽/)).toBeInTheDocument();
  });

  it('says plainly that card data is never collected', () => {
    renderWithProviders(<TermsPage />);

    expect(screen.getByText(/данные банковских карт сайт не собирает/i)).toBeInTheDocument();
  });
});
