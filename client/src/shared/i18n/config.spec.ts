import { describe, expect, it } from 'vitest';
import en from './messages/en.json';
import ru from './messages/ru.json';
import { defaultLocale, isLocale, LOCALE_COOKIE, locales } from './config';

describe('locale configuration', () => {
  it('offers Russian and English, Russian first', () => {
    expect(locales).toEqual(['ru', 'en']);
    expect(defaultLocale).toBe('ru');
  });

  it('stores the choice in the cookie next-intl reads on the server', () => {
    expect(LOCALE_COOKIE).toBe('NEXT_LOCALE');
  });

  it.each([['ru'], ['en']])('recognises %s', (value) => {
    expect(isLocale(value)).toBe(true);
  });

  it.each([['fr'], ['RU'], [''], [undefined]])('rejects %p', (value) => {
    expect(isLocale(value)).toBe(false);
  });
});

/**
 * A key present in one catalogue but not the other renders as the raw key
 * path in the UI, which is invisible in Russian-only testing.
 */
describe('message catalogues', () => {
  const flatten = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
      : [prefix];

  const ruKeys = flatten(ru).sort();
  const enKeys = flatten(en).sort();

  it('carries the same keys in both languages', () => {
    expect(enKeys).toEqual(ruKeys);
  });

  it('has no empty strings', () => {
    const empties = flatten(ru).filter((key) => {
      const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], ru);
      return value === '';
    });

    expect(empties).toEqual([]);
  });

  it('covers every section the app renders', () => {
    for (const section of ['common', 'nav', 'footer', 'home', 'catalog', 'cart', 'checkout', 'orders', 'auth']) {
      expect(ru).toHaveProperty(section);
    }
  });

  it('keeps the home sizes table aligned with the seeded pizza diameters', () => {
    expect(Object.keys(ru.home.sizes)).toEqual(['30', '45', '60']);
    expect(Object.keys(en.home.sizes)).toEqual(['30', '45', '60']);
  });
});
