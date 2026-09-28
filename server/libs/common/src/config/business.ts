/**
 * Business rules that more than one service (and the client) has to agree on.
 *
 * These used to be copy-pasted: the delivery fee lived in the orders service,
 * in two client pages and in the marketing copy, so changing the tariff meant
 * four edits and a guaranteed mismatch between what the page promises and what
 * checkout charges. The orders service now reports them to the client with the
 * cart, and everything else reads them from here.
 */

/** Flat delivery fee in kopecks, charged below the free-delivery threshold. */
export const DELIVERY_FEE = 15_000;

/** Order subtotal (kopecks) from which delivery is free. */
export const FREE_DELIVERY_THRESHOLD = 100_000;

/**
 * The timezone the pizzeria actually operates in.
 *
 * `new Date().getHours()` reads the *server's* clock, and the containers run
 * on UTC. So "10:00–23:00" was being enforced as 13:00–02:00 Makhachkala
 * time: an order for 23:30 sailed through to a kitchen that had closed, and
 * one for 12:00 was refused while the kitchen stood open. Hours have to be
 * evaluated where the shop is, not where the process happens to run.
 */
export const BUSINESS_TIMEZONE = 'Europe/Moscow';

/**
 * Default opening hours as minutes from midnight in `BUSINESS_TIMEZONE`,
 * inclusive of the opening minute and exclusive of the closing one.
 *
 * Minutes rather than hours because the shops open at 11:30, and a whole-hour
 * number can only round that — either taking orders before anyone is there to
 * cook them, or turning customers away for the first half hour of the day.
 *
 * A branch carries its own; these are what a branch is created with, and what
 * the marketing copy quotes when no particular branch is in question.
 */
export const OPEN_MINUTE = 11 * 60 + 30; // 11:30
export const CLOSE_MINUTE = 23 * 60 + 30; // 23:30

/** Minutes in a day, for wrapping arithmetic. */
const DAY_MINUTES = 24 * 60;

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
 * Minutes since midnight at `date`, as read in the pizzeria's timezone.
 *
 * `Intl` is doing the work rather than an offset constant because Moscow time
 * is UTC+3 today and an offset hardcoded here would be a bug waiting for the
 * next time that changes.
 */
export function minuteInBusinessTimezone(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const value = (type: 'hour' | 'minute') => Number(parts.find((part) => part.type === type)?.value ?? 0);

  // "24" is how some ICU builds spell midnight.
  return (value('hour') % 24) * 60 + value('minute');
}

/**
 * True when `date` falls inside the hours the kitchen actually works.
 *
 * Takes the hours rather than reading a constant, so a scheduled order is
 * checked against the branch that will cook it. Callers with no branch in
 * hand get the company default.
 *
 * Two shapes of day, and the difference is not cosmetic:
 *
 *  - An ordinary one, 11:30–23:30, is the half-open interval between them.
 *  - One that runs past midnight, 11:30–6:00, is everything *outside* the
 *    interval instead. Comparing it the ordinary way would leave the branch
 *    shut at every hour of the day, which is how a kitchen that works all
 *    night ends up refusing every order it is sent.
 *
 * Equal minutes mean it never closes; that is the only reading of "opens and
 * closes at the same moment" that is any use to anyone.
 */
export function isWithinOpeningHours(date: Date, hours: OpeningHours = DEFAULT_OPENING_HOURS): boolean {
  const minute = minuteInBusinessTimezone(date);
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

/**
 * Whether an item can be ordered right now.
 *
 * Two different questions, deliberately kept apart: `isActive` is whether the
 * shop sells this at all, `stoppedUntil` is whether it has any left tonight.
 * A stamp in the past needs no job to clear it — it simply stops matching.
 */
export function isOrderable(product: { isActive: boolean; stoppedUntil?: Date | null }, now = new Date()): boolean {
  if (!product.isActive) return false;
  return !product.stoppedUntil || product.stoppedUntil <= now;
}

/** A scheduled delivery must be at least this far in the future. */
export const MIN_SCHEDULE_LEAD_MINUTES = 30;

/** Loyalty: one point is worth one rouble off a future order. */
export const POINT_VALUE_KOPECKS = 100;

export interface DeliveryTerms {
  deliveryFee: number;
  freeDeliveryThreshold: number;
}

/** What delivery costs for a given subtotal. */
export function deliveryFeeFor(subtotal: number): number {
  return subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
}
