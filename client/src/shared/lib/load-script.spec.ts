import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadScript } from './load-script';

/** Each test uses its own URL: the loader caches by src, on purpose. */
let counter = 0;
const uniqueSrc = () => `https://example.test/bundle-${counter++}.js`;

/** Fires the load or error event on the tag the loader just appended. */
function settleLast(event: 'load' | 'error') {
  const scripts = document.querySelectorAll('script');
  scripts[scripts.length - 1].dispatchEvent(new Event(event));
}

beforeEach(() => {
  document.head.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadScript', () => {
  it('appends the tag and resolves when it loads', async () => {
    const src = uniqueSrc();
    const pending = loadScript(src);

    expect(document.querySelector(`script[src="${src}"]`)).not.toBeNull();
    settleLast('load');

    await expect(pending).resolves.toBeUndefined();
  });

  /**
   * Two pickers on a page — or one remounted by a filter change — must not
   * each download the map bundle.
   */
  it('downloads once however many callers ask', async () => {
    const src = uniqueSrc();
    const first = loadScript(src);
    const second = loadScript(src);

    expect(document.querySelectorAll('script')).toHaveLength(1);
    settleLast('load');

    await Promise.all([first, second]);
  });

  it('resolves at once for a script already loaded', async () => {
    const src = uniqueSrc();
    const done = loadScript(src);
    settleLast('load');
    await done;

    // A different caller, after the cache was cleared by a fresh module
    // instance, still finds the tag marked as loaded.
    await expect(loadScript(src)).resolves.toBeUndefined();
  });

  it('rejects when the script fails', async () => {
    const src = uniqueSrc();
    const pending = loadScript(src);
    settleLast('error');

    await expect(pending).rejects.toThrow(/Failed to load/);
  });

  it('lets a later attempt retry after a failure', async () => {
    const src = uniqueSrc();
    const failed = loadScript(src);
    settleLast('error');
    await expect(failed).rejects.toThrow();

    // The rejected promise must not be cached, or a transient network blip
    // would disable the map for the rest of the session.
    const retry = loadScript(src);
    settleLast('load');
    await expect(retry).resolves.toBeUndefined();
  });

  it('removes the tag of a failed load', async () => {
    const src = uniqueSrc();
    const pending = loadScript(src);
    settleLast('error');
    await expect(pending).rejects.toThrow();

    expect(document.querySelector(`script[src="${src}"]`)).toBeNull();
  });
});
