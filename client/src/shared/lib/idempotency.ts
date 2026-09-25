/**
 * A random key identifying one checkout *attempt*.
 *
 * Held for as long as the customer is on the checkout screen, so a double tap
 * or a retry after a dropped connection carries the same key and the server
 * recognises it as the same attempt instead of placing a second order.
 *
 * `crypto.randomUUID` only exists in a secure context, and this stack is
 * reachable over plain HTTP on a LAN. Falling back keeps idempotency working
 * there rather than silently dropping the one guard that stops double
 * charging.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // Last resort. Uniqueness per customer is all that is needed — the key is
  // namespaced by user id on the server — and this is never reached in a
  // browser that can run the rest of the app.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}
