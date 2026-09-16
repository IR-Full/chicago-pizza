import { describe, expect, it } from 'vitest';
import { formatPrice, orderNumber } from './format';

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
