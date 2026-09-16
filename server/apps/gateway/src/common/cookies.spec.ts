import { clearAuthCookies, setAuthCookies } from './cookies';

/**
 * Regression guard: auth cookies were once marked `Secure` whenever
 * NODE_ENV=production. The Compose stack runs production builds over plain
 * HTTP, so the browser silently dropped them and login never persisted.
 */
function fakeResponse() {
  const cookies: { name: string; value: string; options: Record<string, unknown> }[] = [];
  return {
    cookies,
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      cookies.push({ name, value, options });
    },
    clearCookie: (name: string, options: Record<string, unknown>) => {
      cookies.push({ name, value: '', options });
    },
  };
}

const TOKENS = {
  accessToken: 'access',
  refreshToken: 'refresh',
  refreshTokenExpiresAt: new Date('2030-01-01'),
};

describe('auth cookies', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is not Secure when the site is served over plain HTTP', () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'http://localhost';
    delete process.env.COOKIE_SECURE;

    const res = fakeResponse();
    setAuthCookies(res as never, TOKENS);

    expect(res.cookies.every((c) => c.options.secure === false)).toBe(true);
  });

  it('is Secure when the site is served over HTTPS', () => {
    process.env.CLIENT_URL = 'https://chicago-pizza.ru';
    delete process.env.COOKIE_SECURE;

    const res = fakeResponse();
    setAuthCookies(res as never, TOKENS);

    expect(res.cookies.every((c) => c.options.secure === true)).toBe(true);
  });

  it('honours an explicit COOKIE_SECURE override (TLS terminated upstream)', () => {
    process.env.CLIENT_URL = 'http://internal-host';
    process.env.COOKIE_SECURE = 'true';

    const res = fakeResponse();
    setAuthCookies(res as never, TOKENS);

    expect(res.cookies.every((c) => c.options.secure === true)).toBe(true);
  });

  it('always sets httpOnly and SameSite=Lax', () => {
    process.env.CLIENT_URL = 'http://localhost';

    const res = fakeResponse();
    setAuthCookies(res as never, TOKENS);

    expect(res.cookies.every((c) => c.options.httpOnly === true)).toBe(true);
    expect(res.cookies.every((c) => c.options.sameSite === 'lax')).toBe(true);
  });

  it('scopes the refresh cookie to the auth routes only', () => {
    const res = fakeResponse();
    setAuthCookies(res as never, TOKENS);

    const refresh = res.cookies.find((c) => c.name === 'refresh_token');
    const access = res.cookies.find((c) => c.name === 'access_token');

    expect(refresh?.options.path).toBe('/api/auth');
    expect(access?.options.path).toBe('/');
  });

  it('clears both cookies with matching paths', () => {
    const res = fakeResponse();
    clearAuthCookies(res as never);

    expect(res.cookies.map((c) => c.name).sort()).toEqual(['access_token', 'refresh_token']);
    expect(res.cookies.find((c) => c.name === 'refresh_token')?.options.path).toBe('/api/auth');
  });
});
