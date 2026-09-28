import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guestCart } from './guest-cart';

const KEY = 'chicago-pizza:guest-cart';
const PEPPERONI = { productId: 'p1', sizeCm: 45 };

const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? '[]');

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guestCart — adding', () => {
  it('keeps a configuration, never a price', () => {
    guestCart.add(PEPPERONI, 2);

    // The browser is not a trustworthy place to decide what a pizza costs;
    // the list is sent to the server to be valued.
    expect(stored()).toEqual([
      { lineId: expect.any(String), config: PEPPERONI, quantity: 2 },
    ]);
  });

  it('merges an identical configuration into one line', () => {
    guestCart.add(PEPPERONI, 1);
    guestCart.add({ ...PEPPERONI }, 2);

    expect(stored()).toHaveLength(1);
    expect(stored()[0].quantity).toBe(3);
  });

  it('treats a different size as a different line', () => {
    guestCart.add(PEPPERONI, 1);
    guestCart.add({ ...PEPPERONI, sizeCm: 30 }, 1);

    expect(stored()).toHaveLength(2);
  });

  it('ignores the order of removed ingredients when matching', () => {
    // Two customers asking for the same pizza without onion and without
    // pepper have built the same pizza, whichever box they unticked first.
    guestCart.add({ ...PEPPERONI, removedIngredientIds: ['a', 'b'] }, 1);
    guestCart.add({ ...PEPPERONI, removedIngredientIds: ['b', 'a'] }, 1);

    expect(stored()).toHaveLength(1);
  });

  it('caps a line at fifty, like the server does', () => {
    guestCart.add(PEPPERONI, 40);
    guestCart.add(PEPPERONI, 40);

    expect(stored()[0].quantity).toBe(50);
  });

  it('stops accepting new lines at the cart limit', () => {
    for (let index = 0; index < 60; index++) guestCart.add({ productId: `p${index}` }, 1);

    expect(stored()).toHaveLength(50);
  });
});

describe('guestCart — editing', () => {
  it('changes a quantity', () => {
    guestCart.add(PEPPERONI, 1);
    const [line] = stored();

    guestCart.setQuantity(line.lineId, 4);

    expect(stored()[0].quantity).toBe(4);
  });

  it('treats a quantity of zero as a removal', () => {
    guestCart.add(PEPPERONI, 1);
    const [line] = stored();

    guestCart.setQuantity(line.lineId, 0);

    expect(stored()).toEqual([]);
  });

  it('removes and clears', () => {
    guestCart.add(PEPPERONI, 1);
    guestCart.add({ productId: 'p2' }, 1);
    const [first] = stored();

    guestCart.remove(first.lineId);
    expect(stored()).toHaveLength(1);

    guestCart.clear();
    expect(stored()).toEqual([]);
  });
});

/**
 * localStorage is shared with other tabs, older versions of this app and
 * whoever opens the console. Anything in there is untrusted input.
 */
describe('guestCart — surviving a hostile localStorage', () => {
  it.each([
    ['not JSON at all', 'definitely-not-json'],
    ['a JSON object rather than a list', '{"lineId":"x"}'],
  ])('reads an empty cart from %s', (_label, raw) => {
    window.localStorage.setItem(KEY, raw);

    expect(guestCart.lines()).toEqual([]);
  });

  it('drops entries that are not cart lines', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([{ lineId: 'l1', config: { productId: 'p1' }, quantity: 1 }, null, 42, { nope: true }]),
    );

    expect(guestCart.lines()).toHaveLength(1);
  });

  it('keeps working when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });

    // Private mode or blocked cookies must give an empty cart, not a crash.
    expect(guestCart.lines()).toEqual([]);
    expect(() => guestCart.add(PEPPERONI, 1)).not.toThrow();
  });
});
