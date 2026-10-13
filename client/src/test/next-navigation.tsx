import { useSyncExternalStore } from 'react';
import { vi } from 'vitest';

/**
 * A `next/navigation` stand-in that actually holds a URL.
 *
 * The usual `{ push: vi.fn() }` mock is enough for a component that only ever
 * navigates away. It is not enough for one whose *state lives in the URL*: the
 * catalog reads its filters from `useSearchParams`, writes them back through
 * the router, and has to re-render with what it just wrote. A mock that
 * records the call and changes nothing would let a component that never
 * re-reads the URL pass every test.
 *
 * So this keeps a single URL string, re-renders subscribers when it changes,
 * and memoises the `URLSearchParams` per URL the way Next does — an unstable
 * object identity there would make any hook depending on it re-run per render,
 * which is a bug the real router would not have surfaced.
 */

let url = '/menu';
const listeners = new Set<() => void>();

function navigate(next: string): void {
  if (next === url) return;
  url = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useUrl(): string {
  return useSyncExternalStore(
    subscribe,
    () => url,
    () => url,
  );
}

const searchParamsCache = new Map<string, URLSearchParams>();

function searchParamsFor(current: string): URLSearchParams {
  const query = current.split('?')[1] ?? '';
  let cached = searchParamsCache.get(query);
  if (!cached) {
    cached = new URLSearchParams(query);
    searchParamsCache.set(query, cached);
  }
  return cached;
}

export const routerMock = {
  push: vi.fn((next: string) => navigate(next)),
  replace: vi.fn((next: string) => navigate(next)),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

/** Points the mock router at a URL before rendering. */
export function setTestUrl(next: string): void {
  url = next;
}

/** Where the component has navigated to. */
export function currentTestUrl(): string {
  return url;
}

/** Call from `beforeEach`: clears the URL and the recorded calls. */
export function resetTestRouter(pathname = '/menu'): void {
  url = pathname;
  listeners.clear();
  searchParamsCache.clear();
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
}

/**
 * The module shape `next/navigation` exports. Wire it up with:
 *
 *   vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationMock);
 */
export const navigationMock = {
  useRouter: () => routerMock,
  usePathname: () => useUrl().split('?')[0],
  useSearchParams: () => searchParamsFor(useUrl()),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn(),
};
