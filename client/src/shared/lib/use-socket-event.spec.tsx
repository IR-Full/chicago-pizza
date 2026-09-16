import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocketEvent, useSocketRoom } from './use-socket-event';

const socket = {
  connected: false,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock('@/shared/api/socket', () => ({ getSocket: () => socket }));

beforeEach(() => {
  socket.connected = false;
  socket.on.mockReset();
  socket.off.mockReset();
  socket.emit.mockReset();
});

describe('useSocketEvent', () => {
  it('subscribes on mount and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useSocketEvent('order:status', vi.fn()));

    expect(socket.on).toHaveBeenCalledWith('order:status', expect.any(Function));

    const listener = socket.on.mock.calls[0][1];
    unmount();

    expect(socket.off).toHaveBeenCalledWith('order:status', listener);
  });

  it('passes the payload to the handler', () => {
    const handler = vi.fn();
    renderHook(() => useSocketEvent('order:status', handler));

    socket.on.mock.calls[0][1]({ orderId: 'order-1' });

    expect(handler).toHaveBeenCalledWith({ orderId: 'order-1' });
  });

  it('does not re-subscribe when the handler identity changes', () => {
    const { rerender } = renderHook<void, { handler: (payload: unknown) => void }>(
      ({ handler }) => useSocketEvent('order:status', handler),
      { initialProps: { handler: vi.fn() } },
    );

    rerender({ handler: vi.fn() });

    // A fresh closure every render must not churn the socket subscription.
    expect(socket.on).toHaveBeenCalledTimes(1);
  });

  it('always calls the latest handler', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook<void, { handler: (payload: unknown) => void }>(
      ({ handler }) => useSocketEvent('order:status', handler),
      { initialProps: { handler: first } },
    );

    rerender({ handler: second });
    socket.on.mock.calls[0][1]({ orderId: 'order-1' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ orderId: 'order-1' });
  });

  it('stays idle while disabled', () => {
    renderHook(() => useSocketEvent('order:status', vi.fn(), false));

    expect(socket.on).not.toHaveBeenCalled();
  });

  it('subscribes once enabled', () => {
    const { rerender } = renderHook<void, { enabled: boolean }>(
      ({ enabled }) => useSocketEvent('order:status', vi.fn(), enabled),
      { initialProps: { enabled: false } },
    );

    rerender({ enabled: true });

    expect(socket.on).toHaveBeenCalledTimes(1);
  });
});

describe('useSocketRoom', () => {
  it('joins immediately when already connected', () => {
    socket.connected = true;

    renderHook(() => useSocketRoom('order:subscribe', { orderId: 'order-1' }));

    expect(socket.emit).toHaveBeenCalledWith('order:subscribe', { orderId: 'order-1' });
  });

  it('waits for the connection before joining', () => {
    renderHook(() => useSocketRoom('order:subscribe', { orderId: 'order-1' }));

    expect(socket.emit).not.toHaveBeenCalled();

    const onConnect = socket.on.mock.calls.find(([event]) => event === 'connect')![1];
    onConnect();

    expect(socket.emit).toHaveBeenCalledWith('order:subscribe', { orderId: 'order-1' });
  });

  it('re-joins after a reconnect, otherwise the room is lost', () => {
    socket.connected = true;
    renderHook(() => useSocketRoom('ticket:subscribe', { ticketId: 't1' }));

    const onConnect = socket.on.mock.calls.find(([event]) => event === 'connect')![1];
    onConnect();

    expect(socket.emit).toHaveBeenCalledTimes(2);
  });

  it('detaches the reconnect handler on unmount', () => {
    const { unmount } = renderHook(() => useSocketRoom('order:subscribe', { orderId: 'order-1' }));
    const join = socket.on.mock.calls.find(([event]) => event === 'connect')![1];

    unmount();

    expect(socket.off).toHaveBeenCalledWith('connect', join);
  });

  it('does nothing without a payload', () => {
    renderHook(() => useSocketRoom('order:subscribe', null));

    expect(socket.on).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
