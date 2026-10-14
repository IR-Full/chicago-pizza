import { describe, expect, it } from 'vitest';
import { safeRedirect } from './safe-redirect';

describe('safeRedirect', () => {
  it.each(['/admin/tickets', '/checkout', '/menu?category=drinks#kinza'])(
    'preserves internal path %s',
    (path) => {
      expect(safeRedirect(path)).toBe(path);
    },
  );
  it.each([
    null,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '/\nevil',
  ])('refuses external or malformed path %s', (path) => {
    expect(safeRedirect(path)).toBe('/menu');
  });
});
