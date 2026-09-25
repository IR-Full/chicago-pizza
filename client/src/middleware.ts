import { NextRequest, NextResponse } from 'next/server';
import { INTERNAL_API_URL } from '@/shared/config/env';

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

/**
 * Renews an expired session before the page is rendered.
 *
 * The access-token cookie carries a short `Max-Age`, so the browser drops it
 * on expiry while the refresh cookie lives on. Until now that state was only
 * repaired in the browser: `apiRequest` retries a 401 after refreshing, but
 * it cannot do that during a server render — there is no response to attach
 * new cookies to by then. So a customer coming back after twenty minutes got
 * a server-rendered "please sign in", and only saw their account once some
 * client-side query had 401'd and recovered. The session was never actually
 * gone; the page just could not see it.
 *
 * Middleware is the one place that runs before the render *and* owns the
 * response, so it can rotate the pair and hand the fresh token to both the
 * render and the browser in the same pass.
 */
export async function middleware(request: NextRequest) {
  const hasAccess = request.cookies.has(ACCESS_COOKIE);
  const hasRefresh = request.cookies.has(REFRESH_COOKIE);

  // Either the session is fine or there is nothing to restore it from.
  if (hasAccess || !hasRefresh) return NextResponse.next();

  let refreshed: Response;
  try {
    refreshed = await fetch(`${INTERNAL_API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
  } catch {
    // The gateway being unreachable must not take the page down with it; the
    // visitor simply stays logged out for this render.
    return NextResponse.next();
  }

  // A refused refresh is ordinary — a revoked or reused token. Leaving the
  // stale cookie alone lets the API answer 401 and the client clear it.
  if (!refreshed.ok) return NextResponse.next();

  const setCookies = refreshed.headers.getSetCookie();
  const freshAccess = readCookieValue(setCookies, ACCESS_COOKIE);
  if (!freshAccess) return NextResponse.next();

  // Rewrite the *request* too, not just the response: without this the render
  // happening a moment later still reads the old (absent) cookie, and the
  // refresh would only take effect on the following navigation.
  request.cookies.set(ACCESS_COOKIE, freshAccess);
  const response = NextResponse.next({ request: { headers: request.headers } });

  // The refresh token rotates on every use, so every cookie the gateway set
  // has to reach the browser — dropping the new refresh cookie would log the
  // customer out on the next expiry, and trip the reuse detection.
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);

  return response;
}

/** Pulls one cookie's value out of a `Set-Cookie` list. */
function readCookieValue(setCookies: string[], name: string): string | null {
  for (const cookie of setCookies) {
    const [pair] = cookie.split(';');
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    return pair.slice(separator + 1).trim();
  }
  return null;
}

export const config = {
  /**
   * Pages only. Static assets, the service worker and image requests have no
   * session to refresh, and putting a network call in front of each of them
   * would be a self-inflicted latency tax.
   */
  matcher: ['/((?!_next/static|_next/image|icons|favicon.ico|manifest.webmanifest|sw.js|offline.html).*)'],
};
