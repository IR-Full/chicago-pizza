import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import { api } from '@/shared/api/api-client';
import { PushToggle } from './push-toggle';

vi.mock('@/shared/api/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const subscription = {
  toJSON: () => ({ endpoint: 'https://push.example/phone', keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
};

const pushManager = {
  getSubscription: vi.fn(async () => null as unknown),
  subscribe: vi.fn(async () => subscription),
};

const requestPermission = vi.fn(async () => 'granted');

/** A browser that can do push, with the permission in a given state. */
function stubBrowser(permission: NotificationPermission = 'default') {
  vi.stubGlobal('navigator', {
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission, requestPermission });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ publicKey: 'BPublicKey' } as never);
  vi.mocked(api.post).mockResolvedValue(undefined as never);
  pushManager.getSubscription.mockResolvedValue(null);
  requestPermission.mockResolvedValue('granted');
  stubBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PushToggle — when it appears', () => {
  it('offers to turn notifications on', async () => {
    renderWithProviders(<PushToggle />);

    expect(await screen.findByRole('button', { name: /Включить/ })).toBeInTheDocument();
  });

  /**
   * A shop that has not generated a VAPID pair must not show a switch that
   * cannot work — an inert control is worse than no control.
   */
  it('renders nothing when the shop has no VAPID keys', async () => {
    vi.mocked(api.get).mockResolvedValue({ publicKey: null } as never);
    const { container } = renderWithProviders(<PushToggle />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders nothing in a browser without push', async () => {
    vi.stubGlobal('navigator', {});
    const { container } = renderWithProviders(<PushToggle />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('explains a refusal instead of offering a button the page cannot undo', async () => {
    stubBrowser('denied');
    renderWithProviders(<PushToggle />);

    expect(await screen.findByText('Уведомления запрещены в настройках браузера')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the off switch for a device that is already subscribed', async () => {
    pushManager.getSubscription.mockResolvedValue(subscription);
    renderWithProviders(<PushToggle />);

    expect(await screen.findByRole('button', { name: /Выключить/ })).toBeInTheDocument();
  });
});

describe('PushToggle — subscribing', () => {
  it('asks the browser, then registers the subscription with the API', async () => {
    renderWithProviders(<PushToggle />);
    fireEvent.click(await screen.findByRole('button', { name: /Включить/ }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/notifications/push-subscription', {
        endpoint: 'https://push.example/phone',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    );
    // Without `userVisibleOnly` the browser refuses to subscribe at all.
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
  });

  it('registers nothing when the customer declines the prompt', async () => {
    requestPermission.mockResolvedValue('denied');
    renderWithProviders(<PushToggle />);

    fireEvent.click(await screen.findByRole('button', { name: /Включить/ }));

    await waitFor(() =>
      expect(screen.getByText('Уведомления запрещены в настройках браузера')).toBeInTheDocument(),
    );
    expect(api.post).not.toHaveBeenCalled();
  });

  it('unsubscribes this device', async () => {
    pushManager.getSubscription.mockResolvedValue(subscription);
    renderWithProviders(<PushToggle />);

    fireEvent.click(await screen.findByRole('button', { name: /Выключить/ }));

    await waitFor(() => expect(subscription.unsubscribe).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /Включить/ })).toBeInTheDocument();
  });
});
