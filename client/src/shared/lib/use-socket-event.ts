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

/** Joins a server-side room (e.g. one order or one ticket) while mounted. */
export function useSocketRoom(subscribeEvent: string, payload: Record<string, string> | null) {
  useEffect(() => {
    if (!payload) return;

    const socket = getSocket();
    const join = () => socket.emit(subscribeEvent, payload);

    if (socket.connected) join();
    // Re-join after a reconnect, otherwise the room membership is lost.
    socket.on('connect', join);

    return () => {
      socket.off('connect', join);
    };
  }, [subscribeEvent, payload]);
}
