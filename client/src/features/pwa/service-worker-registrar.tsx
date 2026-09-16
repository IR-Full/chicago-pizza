'use client';

import { useEffect } from 'react';

/** Registers the service worker in production only — in dev it would cache
 *  stale bundles and make hot reload confusing. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // A failed registration must never break the page.
      });
    };

    // Wait for load so the SW install does not compete with the first paint.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
