import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.fn();

vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => io(...args) }));

async function loadModule() {
  // Each test needs a fresh module: the connection is a module-level single.
  vi.resetModules();
  return import('./socket');
}

beforeEach(() => {
  io.mockReset();
  io.mockImplementation(() => ({ connected: true, disconnect: vi.fn(), on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
});

afterEach(() => vi.restoreAllMocks());

describe('getSocket', () => {
  it('connects to the public websocket url with credentials', async () => {
    const { getSocket } = await loadModule();

    getSocket();

    expect(io).toHaveBeenCalledWith(
      'http://localhost:4000',
      expect.objectContaining({ withCredentials: true, autoConnect: true }),
    );
  });

  it('prefers websocket and falls back to polling', async () => {
    const { getSocket } = await loadModule();

    getSocket();

    expect(io.mock.calls[0][1]).toMatchObject({ transports: ['websocket', 'polling'] });
  });

  it('retries a dropped connection a bounded number of times', async () => {
    const { getSocket } = await loadModule();

    getSocket();

    expect(io.mock.calls[0][1]).toMatchObject({ reconnectionAttempts: 10, reconnectionDelay: 1000 });
  });

  it('shares one connection per tab', async () => {
    const { getSocket } = await loadModule();

    const first = getSocket();
    const second = getSocket();

    expect(first).toBe(second);
    expect(io).toHaveBeenCalledTimes(1);
  });

  it('never passes a token — auth rides on the httpOnly cookie', async () => {
    const { getSocket } = await loadModule();

    getSocket();

    expect(JSON.stringify(io.mock.calls[0][1])).not.toContain('token');
  });
});

describe('disconnectSocket', () => {
  it('closes the connection and lets the next call reconnect', async () => {
    const { getSocket, disconnectSocket } = await loadModule();
    const socket = getSocket();

    disconnectSocket();
    getSocket();

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledTimes(2);
  });

  it('is safe to call when nothing is connected', async () => {
    const { disconnectSocket } = await loadModule();

    expect(() => disconnectSocket()).not.toThrow();
  });
});

describe('WS_EVENTS', () => {
  it('matches the names the gateway broadcasts', async () => {
    const { WS_EVENTS } = await loadModule();

    expect(WS_EVENTS).toEqual({
      ORDER_STATUS: 'order:status',
      TICKET_MESSAGE: 'ticket:message',
      NOTIFICATION: 'notification',
    });
  });
});
