import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/utils';
import { ApiError } from '@/shared/api/api-client';
import { Providers } from './providers';

// Capture the client the app builds so its retry policy can be exercised.
const clients: QueryClient[] = [];

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    QueryClient: class extends actual.QueryClient {
      constructor(config?: ConstructorParameters<typeof actual.QueryClient>[0]) {
        super(config);
        clients.push(this as unknown as QueryClient);
      }
    },
  };
});

vi.mock('@tanstack/react-query-devtools', () => ({ ReactQueryDevtools: () => null }));
vi.mock('next-themes', () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('sonner', () => ({ Toaster: () => <div data-testid="toaster" /> }));

const appClient = () => clients[clients.length - 1];
const retryPolicy = () =>
  appClient().getDefaultOptions().queries?.retry as (failureCount: number, error: Error) => boolean;

describe('Providers', () => {
  it('renders the app and mounts the toaster', () => {
    renderWithProviders(
      <Providers>
        <p>содержимое</p>
      </Providers>,
    );

    expect(screen.getByText('содержимое')).toBeInTheDocument();
    expect(screen.getByTestId('toaster')).toBeInTheDocument();
  });

  it('keeps fetched data fresh for half a minute and does not refetch on focus', () => {
    renderWithProviders(
      <Providers>
        <p>содержимое</p>
      </Providers>,
    );

    expect(appClient().getDefaultOptions().queries).toMatchObject({
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    });
  });

  it.each([
    ['a 400', 400],
    ['a 401', 401],
    ['a 404', 404],
  ])('never retries %s — that would only burn the rate limit', (_label, status) => {
    renderWithProviders(
      <Providers>
        <p>содержимое</p>
      </Providers>,
    );

    expect(retryPolicy()(0, new ApiError('нет', status))).toBe(false);
  });

  it('retries a server error twice, then gives up', () => {
    renderWithProviders(
      <Providers>
        <p>содержимое</p>
      </Providers>,
    );

    const retry = retryPolicy();
    expect(retry(0, new ApiError('Bad gateway', 502))).toBe(true);
    expect(retry(1, new ApiError('Bad gateway', 502))).toBe(true);
    expect(retry(2, new ApiError('Bad gateway', 502))).toBe(false);
  });

  it('retries a network failure, which carries no status at all', () => {
    renderWithProviders(
      <Providers>
        <p>содержимое</p>
      </Providers>,
    );

    expect(retryPolicy()(0, new Error('offline'))).toBe(true);
  });
});
