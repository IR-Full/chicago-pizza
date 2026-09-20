import { describe, expect, it } from 'vitest';
import { formatPrice, orderNumber, rublesToKopecks } from './format';

describe('formatPrice', () => {
  it('renders kopecks as whole roubles', () => {
    // 44000 kopecks = 440 ₽ — a stray factor of 100 here would be very visible.
    expect(formatPrice(44000)).toContain('440');
  });

  it('renders zero', () => {
    expect(formatPrice(0)).toContain('0');
  });

  it('rounds sub-rouble amounts rather than showing decimals', () => {
    expect(formatPrice(44050)).not.toContain(',5');
  });
});

describe('orderNumber', () => {
  it('shortens a uuid to an 8-character uppercase code', () => {
    expect(orderNumber('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe('3F2504E0');
  });
});

describe('rublesToKopecks', () => {
  it.each([
    [0, 0],
    [1, 100],
    [430, 43000],
    [0.5, 50],
  ])('converts %s ₽ to %s kopecks', (rubles, expected) => {
    expect(rublesToKopecks(rubles)).toBe(expected);
  });

  it('rounds rather than truncating fractional kopecks', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754 — the admin panel used to
    // write that straight into the promocode.
    expect(rublesToKopecks(19.99)).toBe(1999);
  });

  it('round-trips a price back through formatPrice', () => {
    expect(formatPrice(rublesToKopecks(430))).toContain('430');
  });
});
