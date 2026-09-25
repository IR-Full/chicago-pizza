'use client';

import type { PizzaConfig } from '@/shared/api/types';
import { newIdempotencyKey } from '@/shared/lib/idempotency';

/** One line of a cart that lives in this browser. Mirrors the server's shape. */
export interface GuestCartLine {
  lineId: string;
  config: PizzaConfig;
  quantity: number;
}

const STORAGE_KEY = 'chicago-pizza:guest-cart';

/** The same ceiling the server puts on a stored cart. */
const MAX_LINES = 50;
const MAX_QUANTITY = 50;

/**
 * The cart of a visitor who has not signed in.
 *
 * Until now there was none: the cart lived in Redis keyed by user id, so
 * adding a pizza required an account first. For a delivery shop that is the
 * most expensive barrier on the site — the customer has to commit before they
 * have been given a reason to.
 *
 * Only *configurations* are kept here, never prices. The browser is not a
 * trustworthy place to decide what something costs, so the list is sent to
 * the server to be valued, exactly as the stored cart is.
 */
function read(): GuestCartLine[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Anything could be in localStorage — another tab, an older version of
    // this app, a curious user. Keep only what still looks like a line.
    return parsed.filter(
      (line): line is GuestCartLine =>
        typeof line === 'object' &&
        line !== null &&
        typeof (line as GuestCartLine).lineId === 'string' &&
        typeof (line as GuestCartLine).quantity === 'number' &&
        typeof (line as GuestCartLine).config?.productId === 'string',
    );
  } catch {
    // Corrupt JSON, or storage disabled entirely (private mode, blocked
    // cookies). An empty cart is a working site; a thrown error is not.
    return [];
  }
}

function write(lines: GuestCartLine[]): GuestCartLine[] {
  if (typeof window === 'undefined') return lines;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Out of quota or storage blocked: the cart survives in memory for this
    // page at least, and the customer is not shown an error about it.
  }
  return lines;
}

/** Two lines are the same line when they describe the same pizza. Mirrors `CartService.sameConfig`. */
function sameConfig(a: PizzaConfig, b: PizzaConfig): boolean {
  const norm = (ids?: string[]) => [...(ids ?? [])].sort().join(',');
  return (
    a.productId === b.productId &&
    (a.secondHalfProductId ?? null) === (b.secondHalfProductId ?? null) &&
    (a.sizeCm ?? null) === (b.sizeCm ?? null) &&
    (a.doughTypeId ?? null) === (b.doughTypeId ?? null) &&
    norm(a.addedIngredientIds) === norm(b.addedIngredientIds) &&
    norm(a.removedIngredientIds) === norm(b.removedIngredientIds)
  );
}

export const guestCart = {
  lines: read,

  add(config: PizzaConfig, quantity: number): GuestCartLine[] {
    const lines = read();
    const existing = lines.find((line) => sameConfig(line.config, config));

    if (existing) {
      existing.quantity = Math.min(existing.quantity + quantity, MAX_QUANTITY);
    } else {
      if (lines.length >= MAX_LINES) return lines;
      lines.push({ lineId: newIdempotencyKey(), config, quantity });
    }

    return write(lines);
  },

  setQuantity(lineId: string, quantity: number): GuestCartLine[] {
    if (quantity <= 0) return guestCart.remove(lineId);

    const lines = read().map((line) =>
      line.lineId === lineId ? { ...line, quantity: Math.min(quantity, MAX_QUANTITY) } : line,
    );
    return write(lines);
  },

  remove(lineId: string): GuestCartLine[] {
    return write(read().filter((line) => line.lineId !== lineId));
  },

  clear(): GuestCartLine[] {
    return write([]);
  },
};
