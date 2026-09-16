import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { Header } from './header';

const pathname = vi.fn(() => '/');
const user = vi.fn(() => ({ data: null as Record<string, unknown> | null }));
const cart = vi.fn(() => ({ data: { itemCount: 0 } }));
const logoutMutate = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => user() }));
vi.mock('@/entities/cart/queries', () => ({ useCart: () => cart() }));
vi.mock('@/features/auth/model/use-auth', () => ({
  useLogout: () => ({ mutate: logoutMutate, isPending: false }),
}));
vi.mock('@/features/theme/theme-toggle', () => ({ ThemeToggle: () => <button type="button">Тема</button> }));
vi.mock('@/features/locale/locale-switcher', () => ({ LocaleSwitcher: () => <button type="button">RU</button> }));

beforeEach(() => {
  vi.clearAllMocks();
  pathname.mockReturnValue('/');
  user.mockReturnValue({ data: null });
  cart.mockReturnValue({ data: { itemCount: 0 } });
});

const asCustomer = () => user.mockReturnValue({ data: { id: 'user-1', role: 'USER' } });
const asStaff = (role: string) => user.mockReturnValue({ data: { id: 'staff-1', role } });

describe('Header — brand and cart', () => {
  it('shows the brand mark and links home', () => {
    renderWithProviders(<Header />);

    const brand = screen.getByRole('link', { name: /Chicago Pizza/ });
    expect(brand).toHaveAttribute('href', '/');
    expect(within(brand).getByText('Ч')).toBeInTheDocument();
  });

  it('shows the cart count', () => {
    cart.mockReturnValue({ data: { itemCount: 3 } });
    renderWithProviders(<Header />);

    const cartLink = screen.getByRole('link', { name: 'Корзина' });
    expect(cartLink).toHaveAttribute('href', '/cart');
    expect(within(cartLink).getByText('3')).toBeInTheDocument();
  });

  it('falls back to zero before the cart has loaded', () => {
    cart.mockReturnValue({ data: undefined as never });
    renderWithProviders(<Header />);

    expect(within(screen.getByRole('link', { name: 'Корзина' })).getByText('0')).toBeInTheDocument();
  });
});

describe('Header — navigation by role', () => {
  it('shows only the menu link to a guest, plus a way to sign in', () => {
    renderWithProviders(<Header />);

    expect(screen.getAllByRole('link', { name: 'Меню' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Мои заказы' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Войти' }).length).toBeGreaterThan(0);
  });

  it('adds orders and support for a signed-in customer', () => {
    asCustomer();
    renderWithProviders(<Header />);

    expect(screen.getAllByRole('link', { name: 'Мои заказы' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Поддержка' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Админка' })).not.toBeInTheDocument();
  });

  it.each([['ADMIN'], ['SUPPORT'], ['COURIER']])('adds the admin link for %s', (role) => {
    asStaff(role);
    renderWithProviders(<Header />);

    expect(screen.getAllByRole('link', { name: 'Админка' }).length).toBeGreaterThan(0);
  });

  it('marks the active route for assistive tech', () => {
    pathname.mockReturnValue('/menu');
    renderWithProviders(<Header />);

    const menuLink = screen.getAllByRole('link', { name: 'Меню' })[0];
    expect(menuLink).toHaveAttribute('aria-current', 'page');
  });

  it('offers a profile link and logout to a signed-in customer', () => {
    asCustomer();
    renderWithProviders(<Header />);

    expect(screen.getByRole('link', { name: 'Профиль' })).toHaveAttribute('href', '/profile');

    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    expect(logoutMutate).toHaveBeenCalled();
  });
});

describe('Header — mobile sheet', () => {
  it('opens and closes the full-screen menu', () => {
    renderWithProviders(<Header />);

    const burger = screen.getByRole('button', { name: 'Меню' });
    expect(burger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(burger);
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+7 8722 55-55-55' })).toHaveAttribute('href', 'tel:+78722555555');

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument();
  });

  it('locks the page behind the sheet and releases it on close', () => {
    renderWithProviders(<Header />);

    fireEvent.click(screen.getByRole('button', { name: 'Меню' }));
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('closes itself when the route changes', () => {
    const { rerender } = renderWithProviders(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'Меню' }));

    pathname.mockReturnValue('/menu');
    rerender(<Header />);

    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument();
  });

  it('offers logout inside the sheet for a signed-in customer', () => {
    asCustomer();
    renderWithProviders(<Header />);

    fireEvent.click(screen.getByRole('button', { name: 'Меню' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Выйти' }).at(-1)!);

    expect(logoutMutate).toHaveBeenCalled();
  });
});
