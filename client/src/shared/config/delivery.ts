/**
 * Marketing copy ("free from 1000 ₽") is rendered on static pages that never
 * touch the cart API, so it needs the numbers locally. Everything that
 * actually charges the customer reads `deliveryFee` / `freeDeliveryThreshold`
 * off the cart response instead — the server is the single authority.
 *
 * Keep in sync with `server/libs/common/src/config/business.ts`.
 */
export const DELIVERY_FEE_KOPECKS = 15_000;
export const FREE_DELIVERY_THRESHOLD_KOPECKS = 100_000;

/**
 * Opening hours, used to keep the scheduled-delivery picker from offering a
 * 04:00 slot the server would reject anyway.
 *
 * Keep in sync with `server/libs/common/src/config/business.ts`.
 */
export const OPENING_HOUR = 10;
export const CLOSING_HOUR = 23;
export const MIN_SCHEDULE_LEAD_MINUTES = 30;

/**
 * The timezone the pizzeria operates in.
 *
 * The picker used to read the visitor's own clock, so someone ordering from
 * Kaliningrad or a laptop left on New York time was offered slots the server
 * then refused. The shop's hours belong to the shop.
 *
 * Keep in sync with `BUSINESS_TIMEZONE` in
 * `server/libs/common/src/config/business.ts`.
 */
export const BUSINESS_TIMEZONE = 'Europe/Moscow';

/** The hour of `value` as read in the pizzeria's timezone. */
export function hourInBusinessTimezone(value: Date): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit',
    hour12: false,
  }).format(value);

  // "24" is how some ICU builds spell midnight.
  return Number(hour) % 24;
}

/** True when `value` falls inside the hours the kitchen actually works. */
export function isWithinOpeningHours(value: Date): boolean {
  const hour = hourInBusinessTimezone(value);
  return hour >= OPENING_HOUR && hour < CLOSING_HOUR;
}
