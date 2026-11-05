import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { Header } from './header';

vi.mock('next/navigation', () => ({
  usePathname: () => '/menu',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/entities/user/queries', () => ({ useCurrentUser: () => ({ data: null }) }));
vi.mock('@/entities/cart/queries', () => ({ useCart: () => ({ data: { itemCount: 0 } }) }));
vi.mock('@/features/auth/model/use-auth', () => ({
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/features/theme/theme-toggle', () => ({ ThemeToggle: () => <button>Тема</button> }));
vi.mock('@/features/locale/locale-switcher', () => ({ LocaleSwitcher: () => <button>RU</button> }));

describe('Header mobile navigation keyboard contract', () => {
  it('names the modal and returns focus to the menu trigger after Escape', async () => {
    renderWithProviders(<Header />);
    const trigger = screen.getByRole('button', { name: 'Меню' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Chicago Pizza' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('closes when selecting the current route, which does not change pathname', () => {
    renderWithProviders(<Header />);
    fireEvent.click(screen.getByRole('button', { name: 'Меню' }));
    const dialog = screen.getByRole('dialog');
    const currentLink = within(dialog).getByRole('link', { name: 'Меню' });
    expect(currentLink).toHaveAttribute('aria-current', 'page');
    currentLink.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(currentLink);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
