/** Accept only a path on this site, never a URL supplied by another site. */
export function safeRedirect(value: string | null, fallback = '/menu'): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://redirect.invalid');
    return url.origin === 'https://redirect.invalid' ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
