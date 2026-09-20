'use client';

import { useEffect } from 'react';

/** Registers the service worker in production only — in dev it would cache
 *  stale bundles and make hot reload confusing. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      // The build id in the query makes the browser re-fetch `sw.js` after a
      // deploy; the worker then names its cache after it, so the precached
      // offline page and manifest cannot survive from an older build.
      const url = `/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'}`;
      navigator.serviceWorker.register(url).catch(() => {
        // A failed registration must never break the page.
      });
    };

    // Wait for load so the SW install does not compete with the first paint.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
