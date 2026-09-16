import { CookieOptions, Response } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Whether to mark auth cookies `Secure`.
 *
 * Deliberately derived from the public scheme rather than `NODE_ENV`: the
 * Docker Compose stack runs with NODE_ENV=production but is served over plain
 * HTTP on localhost. Keying off NODE_ENV there would mark the cookies Secure,
 * the browser would refuse to send them back, and every login would silently
 * fail to stick. Set `COOKIE_SECURE` explicitly to override (e.g. when TLS is
 * terminated upstream and CLIENT_URL is not the externally visible URL).
 */
function cookieSecure(): boolean {
  const explicit = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (explicit) return ['true', '1', 'yes', 'on'].includes(explicit);
  return (process.env.CLIENT_URL ?? '').startsWith('https://');
}

/**
 * Tokens are delivered as httpOnly cookies rather than in the JSON body, so
 * client-side JavaScript (and therefore any XSS payload) cannot read them.
 */
function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; refreshTokenExpiresAt: string | Date },
) {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, { ...baseOptions(), maxAge: 15 * 60 * 1000 });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseOptions(),
    // Refresh cookie is scoped to the refresh endpoint only, so it is never
    // sent on ordinary API calls.
    path: '/api/auth',
    expires: new Date(tokens.refreshTokenExpiresAt),
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, baseOptions());
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...baseOptions(), path: '/api/auth' });
}
