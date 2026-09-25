import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

/**
 * The session used to come back only after some client-side query had 401'd
 * and recovered, so the first server-rendered paint showed a signed-out site
 * to someone who was signed in the whole time.
 */
function requestWith(cookies: Record<string, string>): NextRequest {
  const header = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  return new NextRequest('http://localhost:3000/profile', {
    headers: header ? { cookie: header } : {},
  });
}

/** A gateway reply carrying a rotated cookie pair. */
function refreshResponse(cookies: string[], ok = true): Response {
  const headers = new Headers();
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: ok ? 204 : 401, headers });
}

const ROTATED = [
  'access_token=fresh-access; Path=/; HttpOnly; Max-Age=900',
  'refresh_token=fresh-refresh; Path=/; HttpOnly; Max-Age=604800',
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('middleware — when it acts', () => {
  it('does nothing for a live session', async () => {
    await middleware(requestWith({ access_token: 'still-valid', refresh_token: 'r' }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing for a guest', async () => {
    await middleware(requestWith({}));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes when only the access cookie has expired away', async () => {
    fetchMock.mockResolvedValue(refreshResponse(ROTATED));

    await middleware(requestWith({ refresh_token: 'r' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/auth\/refresh$/);
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
    expect((init.headers as Record<string, string>).cookie).toBe('refresh_token=r');
  });
});

describe('middleware — passing the new session on', () => {
  it('forwards every rotated cookie to the browser', async () => {
    fetchMock.mockResolvedValue(refreshResponse(ROTATED));

    const response = await middleware(requestWith({ refresh_token: 'r' }));

    // The refresh token rotates on each use: dropping the new one would log
    // the customer out at the next expiry and trip the reuse detection.
    expect(response.headers.getSetCookie()).toEqual(ROTATED);
  });

  it('hands the fresh token to the render that follows', async () => {
    fetchMock.mockResolvedValue(refreshResponse(ROTATED));
    const request = requestWith({ refresh_token: 'r' });

    await middleware(request);

    // Without rewriting the request, this render still sees no access cookie
    // and the refresh only helps on the *next* navigation.
    expect(request.cookies.get('access_token')?.value).toBe('fresh-access');
  });
});

describe('middleware — when refreshing does not work', () => {
  it('lets the page render as a guest when the gateway refuses', async () => {
    fetchMock.mockResolvedValue(refreshResponse([], false));

    const response = await middleware(requestWith({ refresh_token: 'revoked' }));

    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('survives the gateway being unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    // A broken API must not turn every page into an error page.
    await expect(middleware(requestWith({ refresh_token: 'r' }))).resolves.toBeDefined();
  });

  it('ignores a reply that rotates nothing', async () => {
    fetchMock.mockResolvedValue(refreshResponse(['other=1; Path=/']));
    const request = requestWith({ refresh_token: 'r' });

    const response = await middleware(request);

    expect(request.cookies.has('access_token')).toBe(false);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
