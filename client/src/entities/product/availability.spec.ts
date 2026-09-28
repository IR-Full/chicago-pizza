import { describe, expect, it } from 'vitest';
import { isProductAvailable } from './availability';

const NOW = Date.parse('2026-09-27T18:00:00.000Z');
const at = (iso: string | null, isAvailable = false) =>
  isProductAvailable({ isAvailable, stoppedUntil: iso }, NOW);

describe('isProductAvailable', () => {
  it('trusts the server flag when nothing is stopped', () => {
    expect(at(null, true)).toBe(true);
    // Delisting has no timestamp to re-derive from, so the flag stands.
    expect(at(null, false)).toBe(false);
  });

  it('keeps an item off while its stop is still running', () => {
    expect(at('2026-09-27T19:00:00.000Z')).toBe(false);
  });

  /**
   * The reason this function exists. `setStopped` invalidates the catalog
   * cache; a stop running out invalidates nothing, because nothing runs. The
   * payload therefore keeps saying "sold out" for up to five minutes after
   * the time the customer was promised.
   */
  it('puts it back the moment the stop expires, cached payload or not', () => {
    expect(at('2026-09-27T17:59:59.000Z')).toBe(true);
    expect(at('2026-09-27T18:00:00.000Z')).toBe(true);
  });

  it('does not let a stale flag override a stop that is still running', () => {
    expect(at('2026-09-27T19:00:00.000Z', true)).toBe(false);
  });
});
