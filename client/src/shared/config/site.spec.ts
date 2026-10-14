import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('site metadata URL', () => {
  it.each(['', '   ', undefined])('supports a Docker build without a public URL (%s)', async (value) => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', value);
    vi.resetModules();
    const { SITE_URL } = await import('./site');
    expect(new URL(SITE_URL).origin).toBe('http://localhost:3000');
  });

  it('keeps the configured public domain and removes trailing slashes', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', ' https://chikago-pizza.ru/ ');
    vi.resetModules();
    const { SITE_URL } = await import('./site');
    expect(SITE_URL).toBe('https://chikago-pizza.ru');
  });
});
