import {
  BUSINESS_TIMEZONE,
  CLOSE_MINUTE,
  DELIVERY_FEE,
  deliveryFeeFor,
  formatOpeningMinute,
  FREE_DELIVERY_THRESHOLD,
  isOrderable,
  isWithinOpeningHours,
  MIN_SCHEDULE_LEAD_MINUTES,
  minuteInBusinessTimezone,
  OPEN_MINUTE,
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
    // 11:30 and 23:30 as minutes from midnight. The shops open on the half
    // hour, which is the whole reason these are minutes and not hours.
    expect(OPEN_MINUTE).toBe(690);
    expect(CLOSE_MINUTE).toBe(1410);
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
  /** 2026-09-20 at the given Moscow time, expressed as the UTC instant. */
  const atMoscow = (hour: number, minute = 0) => new Date(Date.UTC(2026, 8, 20, hour - 3, minute, 0));

  it.each([
    ['11:00, not yet — the half hour is the point', 11, 0, false],
    ['11:30, the minute it opens', 11, 30, true],
    ['14:00, the lunch rush', 14, 0, true],
    ['23:00, still time', 23, 0, true],
    ['23:30, the closing minute itself', 23, 30, false],
    ['02:00, very much closed', 2, 0, false],
    ['09:00, not yet', 9, 0, false],
  ])('%s', (_label, hour, minute, expected) => {
    expect(isWithinOpeningHours(atMoscow(hour, minute))).toBe(expected);
  });

  it('reads the time in Moscow, not in UTC', () => {
    // 23:30 UTC is 02:30 the next day in Moscow — after closing.
    const lateUtc = new Date('2026-09-20T23:30:00.000Z');

    expect(minuteInBusinessTimezone(lateUtc)).toBe(2 * 60 + 30);
    expect(isWithinOpeningHours(lateUtc)).toBe(false);
  });

  it('accepts an evening slot that UTC alone would have refused', () => {
    // 22:30 Moscow is 19:30 UTC — open in Moscow, which is what matters.
    const openInMoscow = new Date('2026-09-20T19:30:00.000Z');

    expect(minuteInBusinessTimezone(openInMoscow)).toBe(22 * 60 + 30);
    expect(isWithinOpeningHours(openInMoscow)).toBe(true);
  });

  it('keeps the timezone in one place so the client can mirror it', () => {
    expect(BUSINESS_TIMEZONE).toBe('Europe/Moscow');
  });
});

/**
 * One branch works 11:30 → 6:00. Its closing minute is *lower* than its
 * opening one, and the ordinary `open <= t < close` comparison reads that as
 * an empty interval — the kitchen open all night would refuse every order it
 * was ever sent, at every hour of the day.
 */
describe('a kitchen that works past midnight', () => {
  const allNight = { openMinute: 11 * 60 + 30, closeMinute: 6 * 60 };
  const atMoscow = (hour: number, minute = 0) => new Date(Date.UTC(2026, 8, 20, hour - 3, minute, 0));

  it.each([
    ['11:00, before opening', 11, 0, false],
    ['11:30, the minute it opens', 11, 30, true],
    ['20:00, the evening', 20, 0, true],
    ['23:45, past when everyone else shut', 23, 45, true],
    ['01:30, the small hours', 1, 30, true],
    ['05:59, the last minute', 5, 59, true],
    ['06:00, the closing minute itself', 6, 0, false],
    ['09:00, shut until half eleven', 9, 0, false],
  ])('%s', (_label, hour, minute, expected) => {
    expect(isWithinOpeningHours(atMoscow(hour, minute), allNight)).toBe(expected);
  });

  it('treats equal minutes as never closing', () => {
    const always = { openMinute: 0, closeMinute: 0 };

    expect(isWithinOpeningHours(atMoscow(3), always)).toBe(true);
    expect(isWithinOpeningHours(atMoscow(15), always)).toBe(true);
  });
});

/** Every screen that quotes hours renders them through this. */
describe('formatOpeningMinute', () => {
  it.each([
    [0, '00:00'],
    [690, '11:30'],
    [1410, '23:30'],
    [360, '06:00'],
    [1439, '23:59'],
  ])('renders %i as %s', (minute, expected) => {
    expect(formatOpeningMinute(minute)).toBe(expected);
  });

  it('wraps a full day rather than printing an impossible clock', () => {
    // 1440 is midnight, not "24:00" — the old hour column spelled midnight as
    // 24 and the migration turns it into 0.
    expect(formatOpeningMinute(1440)).toBe('00:00');
    expect(formatOpeningMinute(-30)).toBe('23:30');
  });
});

/**
 * Delisting and "we ran out tonight" are different facts, and the second one
 * has to undo itself — the kitchen will not remember to.
 */
describe('isOrderable', () => {
  const hour = 60 * 60 * 1000;
  const now = new Date('2026-09-24T18:00:00.000Z');

  it('sells an active item with no stop on it', () => {
    expect(isOrderable({ isActive: true, stoppedUntil: null }, now)).toBe(true);
  });

  it('refuses a delisted item whatever the stop says', () => {
    expect(isOrderable({ isActive: false, stoppedUntil: null }, now)).toBe(false);
  });

  it('refuses an item stopped until later tonight', () => {
    expect(isOrderable({ isActive: true, stoppedUntil: new Date(now.getTime() + hour) }, now)).toBe(false);
  });

  it('sells it again once the stop has passed, with nothing to run', () => {
    // No scheduled job clears the flag: the timestamp simply stops matching.
    expect(isOrderable({ isActive: true, stoppedUntil: new Date(now.getTime() - hour) }, now)).toBe(true);
  });

  it('treats the exact moment of expiry as available', () => {
    expect(isOrderable({ isActive: true, stoppedUntil: now }, now)).toBe(true);
  });

  it('defaults to the current clock', () => {
    expect(isOrderable({ isActive: true, stoppedUntil: new Date(Date.now() + hour) })).toBe(false);
  });
});
