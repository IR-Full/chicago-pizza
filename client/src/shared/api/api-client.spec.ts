import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, apiRequest } from './api-client';

/**
 * Every call the browser makes goes through here, including the silent
 * refresh-and-retry on 401. The fetch mock is deliberately explicit so the
 * exact request shape (credentials, headers, body) stays pinned.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/plain' }),
    json: async () => {
      throw new Error('not json');
    },
    text: async () => body,
  } as unknown as Response;
}

const noContent = (): Response =>
  ({ ok: true, status: 204, headers: new Headers(), json: async () => null, text: async () => '' }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const urlOf = (call: number) => String(fetchMock.mock.calls[call][0]);
const initOf = (call: number) => fetchMock.mock.calls[call][1] as RequestInit;

describe('apiRequest — url building', () => {
  it('prefixes the configured API base', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await apiRequest('/products');

    expect(urlOf(0)).toBe('http://localhost:4000/api/products');
  });

  it('tolerates a path without a leading slash', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await apiRequest('products');

    expect(urlOf(0)).toBe('http://localhost:4000/api/products');
  });

  it('serialises the query string', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    await apiRequest('/products', { query: { page: 2, search: 'сыр', isNew: true } });

    const url = new URL(urlOf(0));
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('search')).toBe('сыр');
    expect(url.searchParams.get('isNew')).toBe('true');
  });

  it('drops undefined and empty query values so they never become filters', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    await apiRequest('/products', { query: { search: '', categorySlug: undefined, page: 1 } });

    const url = new URL(urlOf(0));
    expect(url.searchParams.has('search')).toBe(false);
    expect(url.searchParams.has('categorySlug')).toBe(false);
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('keeps a false flag, which is a meaningful filter', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));

    await apiRequest('/products', { query: { isVegetarian: false } });

    expect(new URL(urlOf(0)).searchParams.get('isVegetarian')).toBe('false');
  });
});

describe('apiRequest — request shape', () => {
  it('always sends cookies and skips the cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await apiRequest('/auth/me');

    expect(initOf(0)).toMatchObject({ credentials: 'include', cache: 'no-store' });
  });

  it('lets the caller override the cache mode', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await apiRequest('/products', { cache: 'force-cache' });

    expect(initOf(0).cache).toBe('force-cache');
  });

  it('JSON-encodes a body and sets the content type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: '1' }));

    await apiRequest('/orders', { method: 'POST', body: { addressId: 'addr-1' } });

    expect(initOf(0).body).toBe('{"addressId":"addr-1"}');
    expect(initOf(0).headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('sends no content type when there is no body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await apiRequest('/auth/me');

    expect(initOf(0).headers).not.toHaveProperty('Content-Type');
    expect(initOf(0).body).toBeUndefined();
  });

  it('merges caller headers last so they win', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await apiRequest('/auth/me', { headers: { 'X-Trace': 'abc' } });

    expect(initOf(0).headers).toMatchObject({ 'X-Trace': 'abc' });
  });
});

describe('apiRequest — responses', () => {
  it('returns the parsed JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'p1', name: 'Пепперони' }));

    await expect(apiRequest('/products/p1')).resolves.toEqual({ id: 'p1', name: 'Пепперони' });
  });

  it('returns undefined for 204 without touching the body', async () => {
    fetchMock.mockResolvedValue(noContent());

    await expect(apiRequest('/favorites/p1')).resolves.toBeUndefined();
  });

  it('returns text for a non-JSON response', async () => {
    fetchMock.mockResolvedValue(textResponse('pong'));

    await expect(apiRequest('/health')).resolves.toBe('pong');
  });
});

describe('apiRequest — errors', () => {
  it('throws ApiError carrying the server message and status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Промокод истёк' }, 400));

    await expect(apiRequest('/cart/promocode')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'Промокод истёк',
    });
  });

  it('exposes the raw payload for field-level errors', async () => {
    const payload = { message: ['email must be an email'], error: 'Bad Request' };
    fetchMock.mockResolvedValue(jsonResponse(payload, 400));

    await expect(apiRequest('/auth/register')).rejects.toMatchObject({ payload });
  });

  it('falls back to a status message when the body carries none', async () => {
    fetchMock.mockResolvedValue(textResponse('Bad Gateway', 502));

    await expect(apiRequest('/orders')).rejects.toMatchObject({
      status: 502,
      message: 'Request failed with status 502',
    });
  });

  it('is an Error subclass, so it survives a normal catch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'нет' }, 403));

    await expect(apiRequest('/admin/users')).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest('/admin/users')).rejects.toBeInstanceOf(Error);
  });
});

describe('apiRequest — silent token refresh', () => {
  it('refreshes once and replays the original request', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1' }));

    await expect(apiRequest('/auth/me')).resolves.toEqual({ id: 'user-1' });

    expect(urlOf(1)).toBe('http://localhost:4000/api/auth/refresh');
    expect(initOf(1)).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(urlOf(2)).toBe('http://localhost:4000/api/auth/me');
  });

  it('gives up and surfaces the 401 when the refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: 'no session' }, 401));

    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a network failure during refresh as "not refreshed"', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401))
      .mockRejectedValueOnce(new Error('offline'));

    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ status: 401 });
  });

  it('does not refresh when the caller opts out', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, 401));

    await expect(apiRequest('/auth/refresh', { skipRefresh: true })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between concurrent 401s', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) return jsonResponse({ success: true });
      // Every first attempt is unauthorised; the replay succeeds.
      const calls = fetchMock.mock.calls.filter(([u]) => String(u) === url).length;
      return calls > 1 ? jsonResponse({ ok: url }) : jsonResponse({ message: 'Unauthorized' }, 401);
    });

    await Promise.all([apiRequest('/cart'), apiRequest('/orders'), apiRequest('/auth/me')]);

    // A burst of rotations would trip the server's refresh-reuse detection.
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('does not retry a non-401 failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Нет доступа' }, 403));

    await expect(apiRequest('/admin/users')).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('api verb helpers', () => {
  beforeEach(() => fetchMock.mockResolvedValue(jsonResponse({ ok: true })));

  it('get sends GET without a body', async () => {
    await api.get('/products');

    expect(initOf(0)).toMatchObject({ method: 'GET' });
    expect(initOf(0).body).toBeUndefined();
  });

  it('post sends the body', async () => {
    await api.post('/cart/items', { config: { productId: 'p1' }, quantity: 1 });

    expect(initOf(0)).toMatchObject({ method: 'POST', body: '{"config":{"productId":"p1"},"quantity":1}' });
  });

  it('post works without a body', async () => {
    await api.post('/favorites/p1');

    expect(initOf(0)).toMatchObject({ method: 'POST' });
    expect(initOf(0).body).toBeUndefined();
  });

  it('patch sends the body', async () => {
    await api.patch('/auth/me', { firstName: 'Амина' });

    expect(initOf(0)).toMatchObject({ method: 'PATCH', body: '{"firstName":"Амина"}' });
  });

  it('delete sends DELETE', async () => {
    await api.delete('/cart/items/l1');

    expect(initOf(0)).toMatchObject({ method: 'DELETE' });
  });

  it('forwards options such as the query', async () => {
    await api.get('/products', { query: { page: 2 } });

    expect(new URL(urlOf(0)).searchParams.get('page')).toBe('2');
  });
});
