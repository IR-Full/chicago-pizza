import { afterEach, describe, expect, it, vi } from 'vitest';
import { newIdempotencyKey } from './idempotency';

/** What the gateway accepts in the `Idempotency-Key` header. */
const ACCEPTED_BY_SERVER = /^[A-Za-z0-9_.:-]{8,128}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newIdempotencyKey', () => {
  it('uses the platform UUID when there is one', () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('gives a different key every time', () => {
    const keys = new Set(Array.from({ length: 50 }, newIdempotencyKey));

    expect(keys.size).toBe(50);
  });

  /**
   * `crypto.randomUUID` is undefined outside a secure context, and the stack
   * is reachable over plain HTTP on a LAN. Throwing there would take the
   * double-charge guard down with it.
   */
  it('falls back to random bytes without randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });

    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('still produces a key with no Web Crypto at all', () => {
    vi.stubGlobal('crypto', {});

    expect(newIdempotencyKey()).toMatch(ACCEPTED_BY_SERVER);
  });

  it.each([['full'], ['no-uuid'], ['none']])('produces a key the server accepts (%s crypto)', (mode) => {
    if (mode === 'no-uuid') {
      vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    }
    if (mode === 'none') vi.stubGlobal('crypto', {});

    expect(newIdempotencyKey()).toMatch(ACCEPTED_BY_SERVER);
  });
});
