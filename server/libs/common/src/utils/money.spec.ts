import { formatRub, kopecksToRubles, rublesToKopecks } from './money';

/**
 * Money lives in kopecks precisely so that prices never drift; these cases
 * pin the rounding behaviour at the boundaries where floats misbehave.
 */
describe('money', () => {
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
      // 19.99 * 100 is 1998.9999999999998 in IEEE 754.
      expect(rublesToKopecks(19.99)).toBe(1999);
      expect(rublesToKopecks(0.005)).toBe(1);
      expect(rublesToKopecks(0.004)).toBe(0);
    });

    it('keeps the sign of a negative amount', () => {
      expect(rublesToKopecks(-12.5)).toBe(-1250);
    });
  });

  describe('kopecksToRubles', () => {
    it.each([
      [0, 0],
      [100, 1],
      [43000, 430],
      [1999, 19.99],
    ])('converts %s kopecks to %s ₽', (kopecks, expected) => {
      expect(kopecksToRubles(kopecks)).toBe(expected);
    });

    it('rounds a fractional kopeck before dividing', () => {
      expect(kopecksToRubles(150.4)).toBe(1.5);
      expect(kopecksToRubles(150.6)).toBe(1.51);
    });

    it('round-trips through rublesToKopecks', () => {
      for (const rubles of [0, 1, 19.99, 430, 1290.5]) {
        expect(kopecksToRubles(rublesToKopecks(rubles))).toBe(rubles);
      }
    });
  });

  describe('formatRub', () => {
    it('renders whole roubles with the currency sign', () => {
      // Intl uses a narrow no-break space as the group separator, so compare
      // on the digits and the sign rather than on the exact spacing.
      const formatted = formatRub(43000);
      expect(formatted).toContain('430');
      expect(formatted).toContain('₽');
    });

    it('drops the fractional part', () => {
      expect(formatRub(199950)).not.toContain(',');
    });

    it('formats zero', () => {
      expect(formatRub(0)).toContain('0');
    });
  });
});
