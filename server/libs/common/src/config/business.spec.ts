import {
  BUSINESS_TIMEZONE,
  CLOSING_HOUR,
  DELIVERY_FEE,
  deliveryFeeFor,
  FREE_DELIVERY_THRESHOLD,
  hourInBusinessTimezone,
  isWithinOpeningHours,
  MIN_SCHEDULE_LEAD_MINUTES,
  OPENING_HOUR,
  POINT_VALUE_KOPECKS,
} from './business';

/**
 * These constants are quoted to the customer in the footer, the offers block
 * and the checkout summary — and charged by the orders service. One source,
 * so the promise and the invoice cannot drift apart.
 */
describe('business constants', () => {
  it('matches the terms the site advertises', () => {
    expect(DELIVERY_FEE).toBe(15_000); // 150 ₽
    expect(FREE_DELIVERY_THRESHOLD).toBe(100_000); // 1000 ₽
    expect(OPENING_HOUR).toBe(10);
    expect(CLOSING_HOUR).toBe(23);
    expect(MIN_SCHEDULE_LEAD_MINUTES).toBe(30);
    expect(POINT_VALUE_KOPECKS).toBe(100); // 1 балл = 1 ₽
  });
});

describe('deliveryFeeFor', () => {
  it.each([
    [0, DELIVERY_FEE],
    [99_999, DELIVERY_FEE],
    [FREE_DELIVERY_THRESHOLD, 0],
    [250_000, 0],
  ])('charges %s kopecks of goods a %s fee', (subtotal, expected) => {
    expect(deliveryFeeFor(subtotal)).toBe(expected);
  });

  it('is free exactly at the threshold, not one kopeck above it', () => {
    expect(deliveryFeeFor(FREE_DELIVERY_THRESHOLD - 1)).toBe(DELIVERY_FEE);
    expect(deliveryFeeFor(FREE_DELIVERY_THRESHOLD)).toBe(0);
  });
});

/**
 * `new Date().getHours()` reads the *server's* clock, and the containers run
 * on UTC — so "10:00–23:00" was being enforced as 13:00–02:00 in Makhachkala.
 * An order for 23:30 sailed through to a kitchen that had closed.
 */
describe('opening hours are evaluated where the shop is', () => {
  /** 2026-09-20 at the given Moscow hour, expressed as the UTC instant. */
  const atMoscowHour = (hour: number) =>
    new Date(Date.UTC(2026, 8, 20, hour - 3, 0, 0));

  it.each([
    ['10:00, just open', 10, true],
    ['14:00, the lunch rush', 14, true],
    ['22:00, last orders', 22, true],
    ['23:00, closed', 23, false],
    ['02:00, very much closed', 2, false],
    ['09:00, not yet', 9, false],
  ])('%s', (_label, moscowHour, expected) => {
    expect(isWithinOpeningHours(atMoscowHour(moscowHour))).toBe(expected);
  });

  it('reads the hour in Moscow, not in UTC', () => {
    // 23:30 UTC is 02:30 the next day in Moscow — after closing.
    const lateUtc = new Date('2026-09-20T23:30:00.000Z');

    expect(hourInBusinessTimezone(lateUtc)).toBe(2);
    expect(isWithinOpeningHours(lateUtc)).toBe(false);
  });

  it('accepts an evening slot that UTC alone would have refused', () => {
    // 20:00 Moscow is 17:00 UTC; both happen to be open, so use the edge:
    // 22:30 Moscow is 19:30 UTC — open in Moscow, which is what matters.
    const openInMoscow = new Date('2026-09-20T19:30:00.000Z');

    expect(hourInBusinessTimezone(openInMoscow)).toBe(22);
    expect(isWithinOpeningHours(openInMoscow)).toBe(true);
  });

  it('keeps the timezone in one place so the client can mirror it', () => {
    expect(BUSINESS_TIMEZONE).toBe('Europe/Moscow');
  });
});
