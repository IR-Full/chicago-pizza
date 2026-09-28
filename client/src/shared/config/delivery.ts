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
 * Opening hours as minutes from midnight, used to keep the scheduled-delivery
 * picker from offering a slot the server would reject anyway.
 *
 * Minutes rather than hours because the shops open at 11:30 — see the note on
 * `OPEN_MINUTE` in the server file. Keep in sync with
 * `server/libs/common/src/config/business.ts`.
 */
export const OPEN_MINUTE = 11 * 60 + 30; // 11:30
export const CLOSE_MINUTE = 23 * 60 + 30; // 23:30
export const MIN_SCHEDULE_LEAD_MINUTES = 30;

/** Minutes in a day, for wrapping arithmetic. */
const DAY_MINUTES = 24 * 60;

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

/** Minutes since midnight at `value`, as read in the pizzeria's timezone. */
export function minuteInBusinessTimezone(value: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(value);

  const part = (type: 'hour' | 'minute') => Number(parts.find((p) => p.type === type)?.value ?? 0);

  // "24" is how some ICU builds spell midnight.
  return (part('hour') % 24) * 60 + part('minute');
}

/** Hours of whichever place is being asked about. */
export interface OpeningHours {
  openMinute: number;
  /**
   * Less than or equal to `openMinute` means the kitchen works past midnight
   * — one branch runs 11:30 → 6:00.
   */
  closeMinute: number;
}

export const DEFAULT_OPENING_HOURS: OpeningHours = {
  openMinute: OPEN_MINUTE,
  closeMinute: CLOSE_MINUTE,
};

/**
 * True when `value` falls inside the hours the kitchen actually works.
 *
 * Takes the hours rather than reading the constants, so the picker is checked
 * against the branch that will cook the order — a chain exists so its
 * branches can keep different hours.
 *
 * A day that runs past midnight is the interval turned inside out: comparing
 * it the ordinary way leaves such a branch shut at every hour, which is how a
 * kitchen open all night ends up refusing every order. Mirrors
 * `isWithinOpeningHours` in `server/libs/common/src/config/business.ts`.
 */
export function isWithinOpeningHours(value: Date, hours: OpeningHours = DEFAULT_OPENING_HOURS): boolean {
  const minute = minuteInBusinessTimezone(value);
  const { openMinute, closeMinute } = hours;

  if (openMinute === closeMinute) return true;
  if (openMinute < closeMinute) return minute >= openMinute && minute < closeMinute;
  return minute >= openMinute || minute < closeMinute;
}

/**
 * A minute count as a clock reading — `690` becomes `"11:30"`.
 *
 * Every screen that quotes hours goes through this, so that the half hours
 * survive: the old copy interpolated an integer into "с {from}:00", which
 * cannot say 11:30 at all.
 */
export function formatOpeningMinute(minute: number): string {
  const wrapped = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(wrapped / 60);
  return `${String(hour).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}
