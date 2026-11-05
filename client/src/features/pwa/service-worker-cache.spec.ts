import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const workerSource = readFileSync(resolve('public/sw.js'), 'utf8');

function worker(options: { cachedResponse?: Response; networkResponse?: Response } = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const cache = { put: vi.fn() };
  const caches = {
    match: vi.fn(async () => options.cachedResponse ?? new Response('cached English response')),
    open: vi.fn(async () => cache),
  };
  const fetch = vi.fn(async () => options.networkResponse ?? new Response('fresh Russian response'));

  runInNewContext(workerSource, {
    URL,
    self: {
      location: new URL('https://pizza.test/sw.js?v=locale-test'),
      addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    },
    caches,
    fetch,
  });

  async function request(url: string, headers?: Record<string, string>) {
    const request = new Request(url, { headers });
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({
      request,
      respondWith: (result: Promise<Response>) => {
        response = result;
      },
    });
    // An unintercepted request goes to the browser's network stack.
    return response ? response : fetch();
  }

  return { request, caches, cache };
}

describe('service worker locale isolation', () => {
  it.each([
    ['RSC header', 'https://pizza.test/menu', { RSC: '1' }],
    ['prefetch header', 'https://pizza.test/menu', { 'Next-Router-Prefetch': '1' }],
    ['segment prefetch header', 'https://pizza.test/menu', { 'Next-Router-Segment-Prefetch': '/menu' }],
    ['flight URL', 'https://pizza.test/menu?_rsc=same-router-state', undefined],
  ])('bypasses an old English cache entry for a Russian %s request', async (_, url, headers) => {
    const { request, caches, cache } = worker();
    const response = await request(url, headers);

    expect(await response.text()).toBe('fresh Russian response');
    expect(caches.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { 'cache-control': 'private, no-cache, no-store, max-age=0' },
    { 'cache-control': 'private, max-age=60' },
    { 'cache-control': 'no-store' },
    { 'content-type': 'text/x-component; charset=utf-8' },
  ])('rejects old cached and new network responses marked %j', async (headers) => {
    const { request, cache } = worker({
      cachedResponse: new Response('cached English response', { headers }),
      networkResponse: new Response('fresh Russian response', { headers }),
    });
    const response = await request('https://pizza.test/menu');

    expect(await response.text()).toBe('fresh Russian response');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('still serves static assets from cache and refreshes them', async () => {
    const { request, caches, cache } = worker();
    const response = await request('https://pizza.test/menu/pizza.webp');

    expect(await response.text()).toBe('cached English response');
    expect(caches.match).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('continues to bypass the cache for API requests', async () => {
    const { request, caches } = worker();
    const response = await request('https://pizza.test/api/cart');

    expect(await response.text()).toBe('fresh Russian response');
    expect(caches.match).not.toHaveBeenCalled();
  });
});
