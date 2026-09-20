import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { LocaleSwitcher } from './locale/locale-switcher';
import { ThemeToggle } from './theme/theme-toggle';
import { ServiceWorkerRegistrar } from './pwa/service-worker-registrar';

const router = { refresh: vi.fn(), push: vi.fn() };
const setTheme = vi.fn();
const theme = vi.fn(() => ({ resolvedTheme: 'light', setTheme }));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next-themes', () => ({ useTheme: () => theme() }));

beforeEach(() => {
  vi.clearAllMocks();
  theme.mockReturnValue({ resolvedTheme: 'light', setTheme });
  document.cookie = 'NEXT_LOCALE=; max-age=0; path=/';
});

describe('LocaleSwitcher', () => {
  it('renders both languages as pills', () => {
    renderWithProviders(<LocaleSwitcher />);

    expect(screen.getByRole('button', { name: /RU/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /EN/i })).toBeInTheDocument();
  });

  it('marks the active language as pressed', () => {
    renderWithProviders(<LocaleSwitcher />);

    expect(screen.getByRole('button', { name: /Switch language to RU/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Switch language to EN/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('writes the cookie next-intl reads and refreshes the server components', async () => {
    renderWithProviders(<LocaleSwitcher />);

    fireEvent.click(screen.getByRole('button', { name: /Switch language to EN/ }));

    expect(document.cookie).toContain('NEXT_LOCALE=en');
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('does nothing when the active language is clicked again', () => {
    renderWithProviders(<LocaleSwitcher />);

    fireEvent.click(screen.getByRole('button', { name: /Switch language to RU/ }));

    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('renders in English when that is the active locale', () => {
    renderWithProviders(<LocaleSwitcher />, { locale: 'en' });

    expect(screen.getByRole('button', { name: /Switch language to EN/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ThemeToggle', () => {
  it('offers the dark theme while the light one is active', () => {
    renderWithProviders(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Тёмная' }));

    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('offers the light theme while the dark one is active', () => {
    theme.mockReturnValue({ resolvedTheme: 'dark', setTheme });
    renderWithProviders(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Светлая' }));

    expect(setTheme).toHaveBeenCalledWith('light');
  });
});

describe('ServiceWorkerRegistrar', () => {
  const register = vi.fn(() => Promise.resolve({} as ServiceWorkerRegistration));

  beforeEach(() => {
    register.mockClear();
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('renders nothing', () => {
    const { container } = renderWithProviders(<ServiceWorkerRegistrar />);

    expect(container).toBeEmptyDOMElement();
  });

  it('registers straight away when the page has already loaded', () => {
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

    renderWithProviders(<ServiceWorkerRegistrar />);

    expect(register).toHaveBeenCalledWith(expect.stringMatching(/^\/sw\.js\?v=/));
  });

  it('versions the worker url so a deploy evicts the old offline page', () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'build-42');
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

    renderWithProviders(<ServiceWorkerRegistrar />);

    expect(register).toHaveBeenCalledWith('/sw.js?v=build-42');
  });

  it('waits for load so the install does not compete with the first paint', () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });

    renderWithProviders(<ServiceWorkerRegistrar />);
    expect(register).not.toHaveBeenCalled();

    fireEvent(window, new Event('load'));
    expect(register).toHaveBeenCalledWith(expect.stringMatching(/^\/sw\.js\?v=/));
  });

  it('stays out of the way in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

    renderWithProviders(<ServiceWorkerRegistrar />);

    // A cached dev bundle would break hot reload.
    expect(register).not.toHaveBeenCalled();
  });

  it('never breaks the page when registration is refused', async () => {
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    register.mockRejectedValue(new Error('insecure context') as never);

    expect(() => renderWithProviders(<ServiceWorkerRegistrar />)).not.toThrow();
    await waitFor(() => expect(register).toHaveBeenCalled());
  });

  it('does nothing in a browser without service workers', () => {
    // @ts-expect-error — deleting the API is the point of the test
    delete navigator.serviceWorker;

    expect(() => renderWithProviders(<ServiceWorkerRegistrar />)).not.toThrow();
  });
});
