'use client';

import { io, type Socket } from 'socket.io-client';
import { PUBLIC_WS_URL } from '@/shared/config/env';

let socket: Socket | null = null;

/**
 * One shared Socket.IO connection per tab. Auth rides on the httpOnly
 * `access_token` cookie (`withCredentials`), so no token is ever exposed to
 * JavaScript here.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(PUBLIC_WS_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export const WS_EVENTS = {
  ORDER_STATUS: 'order:status',
  TICKET_MESSAGE: 'ticket:message',
  NOTIFICATION: 'notification',
} as const;
