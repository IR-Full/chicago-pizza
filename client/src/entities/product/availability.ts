import type { Product } from '@/shared/api/types';

/** Everything the answer depends on — so a cart line or a stop-list row works too. */
type Stoppable = Pick<Product, 'isAvailable' | 'stoppedUntil'>;

/**
 * Whether the kitchen will actually make this right now.
 *
 * `isAvailable` arrives already decided by the server — but the catalog is
 * cached for five minutes, and a stop expires on its own clock rather than
 * by anyone doing anything. Taking an item *off* the menu invalidates the
 * cache; the moment it comes back, nothing does. So a pizza stopped until
 * 19:00 kept saying "sold out" until 19:05, which is the whole point of
 * promising a time.
 *
 * Re-deciding it here costs a comparison and needs no round trip. The server
 * still refuses an order for a stopped item — this only governs what the
 * screen offers, and it errs the same way the server does.
 *
 * `stoppedUntil` is the authority whenever it is set: it says exactly when
 * the item returns. Without one there is nothing to re-derive, so the
 * server's flag stands — it also carries delisting, which has no timestamp.
 */
export function isProductAvailable(product: Stoppable, now: number = Date.now()): boolean {
  if (product.stoppedUntil) return new Date(product.stoppedUntil).getTime() <= now;
  return product.isAvailable !== false;
}
