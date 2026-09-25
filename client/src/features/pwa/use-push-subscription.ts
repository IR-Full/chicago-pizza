'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/shared/api/api-client';

/**
 * The browser's own notification permission, plus whether this device is
 * actually subscribed. They are different questions: permission survives an
 * unsubscribe, and a subscription can be dropped by the browser without the
 * permission changing.
 */
export type PushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

/**
 * `applicationServerKey` wants raw bytes, and VAPID keys travel as base64url.
 *
 * Returns the backing `ArrayBuffer` rather than the view: the DOM types accept
 * a plain `ArrayBuffer`, while a `Uint8Array` may be backed by a
 * `SharedArrayBuffer` as far as the compiler knows.
 */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/**
 * Subscribes this browser to order-status pushes, and unsubscribes it again.
 *
 * All of the machinery for this already existed and was never connected: the
 * service worker has had a `push` handler from the start and the API has
 * stored subscriptions since day one, but nothing ever asked the browser to
 * make one. This is the missing half.
 *
 * The public key is fetched at runtime instead of being baked into the bundle,
 * so a shop with no VAPID pair configured reports `unconfigured` and the UI
 * offers nothing rather than a button that cannot work.
 */
export function usePushSubscription() {
  const [state, setState] = useState<PushState>('unsupported');
  const [isBusy, setBusy] = useState(false);

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    (async () => {
      const { publicKey } = await api
        .get<{ publicKey: string | null }>('/notifications/vapid-key')
        .catch(() => ({ publicKey: null }));

      if (cancelled) return;
      if (!publicKey) {
        setState('unconfigured');
        return;
      }
      if (Notification.permission === 'denied') {
        setState('denied');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!cancelled) setState(existing ? 'on' : 'off');
    })().catch(() => {
      if (!cancelled) setState('unsupported');
    });

    return () => {
      cancelled = true;
    };
  }, [supported]);

  const subscribe = useCallback(async () => {
    setBusy(true);
    try {
      const { publicKey } = await api.get<{ publicKey: string | null }>('/notifications/vapid-key');
      if (!publicKey) {
        setState('unconfigured');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Without this the browser refuses to create a subscription at all.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      });

      const { endpoint, keys } = subscription.toJSON() as {
        endpoint: string;
        keys: Record<string, string>;
      };
      await api.post('/notifications/push-subscription', { endpoint, keys });
      setState('on');
    } finally {
      setBusy(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      await subscription?.unsubscribe();
      // The server drops the row by itself the next time the push service
      // reports the endpoint gone, so there is nothing to call here.
      setState('off');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, isBusy, subscribe, unsubscribe };
}
