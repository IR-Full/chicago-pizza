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

/** Pizzeria opening hours, in `BUSINESS_TIMEZONE`, inclusive of the opening hour. */
export const OPENING_HOUR = 10;
export const CLOSING_HOUR = 23;

/**
 * The hour of `date` as read in the pizzeria's timezone.
 *
 * `Intl` is doing the work rather than an offset constant because Moscow time
 * is UTC+3 today and an offset hardcoded here would be a bug waiting for the
 * next time that changes.
 */
export function hourInBusinessTimezone(date: Date): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    hour: '2-digit',
    hour12: false,
  }).format(date);

  // "24" is how some ICU builds spell midnight.
  return Number(hour) % 24;
}

/** True when `date` falls inside the hours the kitchen actually works. */
export function isWithinOpeningHours(date: Date): boolean {
  const hour = hourInBusinessTimezone(date);
  return hour >= OPENING_HOUR && hour < CLOSING_HOUR;
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
