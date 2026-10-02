'use client';

import { useEffect, useRef } from 'react';
import { getSocket } from '@/shared/api/socket';

/**
 * Subscribes to a socket event for the lifetime of the component.
 * The handler is held in a ref so re-renders never cause a re-subscribe.
 */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const socket = getSocket();
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);

    return () => {
      socket.off(event, listener);
    };
  }, [event, enabled]);
}

/**
 * Joins a server-side room (e.g. one order or one ticket) while mounted.
 *
 * Every caller passes a fresh object literal — `orderId ? { orderId } : null` —
 * so depending on `payload` by identity re-ran this effect on *every render*.
 * Each run emitted the subscribe message again, and joining a room is an
 * authorisation decision on the server: it answers by fetching the order or the
 * ticket over RabbitMQ. A page that re-rendered on each query update and each
 * toast was therefore issuing a backend round trip per render, for a room it
 * had already joined.
 *
 * Serialising the payload is what fixes it: the effect now re-runs when the
 * *order id* changes, which is the only thing that should move a socket between
 * rooms.
 */
export function useSocketRoom(subscribeEvent: string, payload: Record<string, string> | null) {
  const serialised = payload ? JSON.stringify(payload) : null;

  useEffect(() => {
    if (!serialised) return;

    const socket = getSocket();
    const join = () => socket.emit(subscribeEvent, JSON.parse(serialised) as Record<string, string>);

    if (socket.connected) join();
    // Re-join after a reconnect, otherwise the room membership is lost.
    socket.on('connect', join);

    return () => {
      socket.off('connect', join);
    };
  }, [subscribeEvent, serialised]);
}
