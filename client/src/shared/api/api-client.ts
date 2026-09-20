import { apiBaseUrl, IS_SERVER } from '@/shared/config/env';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Skip the automatic refresh-and-retry on 401 (used by the refresh call itself). */
  skipRefresh?: boolean;
  /**
   * Seconds the App Router may reuse this response for. Requests without it
   * stay `no-store`, which is what anything user-specific needs — but a single
   * `no-store` fetch also opts the whole route out of ISR, so the public
   * catalog reads pass a revalidate window instead.
   */
  revalidate?: number;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * On the server we must forward the incoming request's cookies manually —
 * `credentials: 'include'` only works in the browser.
 *
 * Cacheable requests deliberately skip this: the session cookie would make
 * the Data Cache key unique per visitor, so a "shared" catalog response would
 * in fact be fetched again for every single person.
 */
async function serverCookieHeader(cacheable: boolean): Promise<Record<string, string>> {
  if (!IS_SERVER || cacheable) return {};
  const { cookies } = await import('next/headers');
  // Async since Next 15. Without the await this stringified the promise
  // itself and sent `[object Promise]` as the Cookie header — typechecks
  // clean, fails silently at runtime.
  const cookieHeader = (await cookies()).toString();
  return cookieHeader ? { cookie: cookieHeader } : {};
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refreshes the access token. Concurrent 401s share a single refresh call so
 * a page issuing several requests does not trigger a burst of rotations
 * (which the reuse-detection on the server would treat as an attack).
 */
async function refreshTokens(): Promise<boolean> {
  if (IS_SERVER) return false;
  if (!refreshInFlight) {
    refreshInFlight = fetch(buildUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, skipRefresh, headers, revalidate, ...rest } = options;

  const doFetch = async (): Promise<Response> =>
    fetch(buildUrl(path, query), {
      ...rest,
      credentials: 'include',
      // `cache` and `next.revalidate` are mutually exclusive in Next 14.
      ...(revalidate === undefined
        ? { cache: rest.cache ?? ('no-store' as RequestCache) }
        : { next: { revalidate } }),
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(await serverCookieHeader(revalidate !== undefined)),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let response = await doFetch();

  if (response.status === 401 && !skipRefresh && !IS_SERVER) {
    const refreshed = await refreshTokens();
    if (refreshed) response = await doFetch();
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
