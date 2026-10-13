import { BadRequestException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RmqAckInterceptor } from './rmq-ack.interceptor';

function harness(replyTo?: string, retries = 0) {
  const message = {
    properties: { replyTo, headers: { 'x-retries': retries } },
    fields: { routingKey: 'orders' },
    content: Buffer.from('{}'),
  };
  const channel = {
    ack: jest.fn(),
    nack: jest.fn(),
    assertQueue: jest.fn(async () => undefined),
    sendToQueue: jest.fn((_q: string, _data: unknown, _options: unknown, callback: (error: null) => void) =>
      callback(null),
    ),
  };
  const context = {
    getType: () => 'rpc',
    switchToRpc: () => ({ getContext: () => ({ getMessage: () => message, getChannelRef: () => channel }) }),
  };
  const run = (fails?: Error) =>
    lastValueFrom(
      new RmqAckInterceptor().intercept(context as never, {
        handle: () => (fails ? throwError(() => fails) : of({ ok: true })),
      }),
    );
  return { channel, message, run };
}

describe('RabbitMQ acknowledgements', () => {
  it('acknowledges exactly once after successful completion', async () => {
    const { channel, message, run } = harness();
    await run();
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(message);
  });
  it('returns RPC failures without replaying the command', async () => {
    const { channel, run } = harness('rpc.reply');
    await expect(run(new Error('database down'))).rejects.toThrow('database down');
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.sendToQueue).not.toHaveBeenCalled();
  });
  it('does not retry invalid input', async () => {
    const { channel, run } = harness();
    await expect(run(new BadRequestException())).rejects.toThrow();
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.sendToQueue).not.toHaveBeenCalled();
  });
  it('confirms republishing before acknowledging a failed event', async () => {
    const { channel, run } = harness();
    await expect(run(new Error('SMTP unavailable'))).rejects.toThrow();
    expect(channel.sendToQueue.mock.calls[0][0]).toBe('orders');
    expect(channel.sendToQueue.mock.invocationCallOrder[0]).toBeLessThan(
      channel.ack.mock.invocationCallOrder[0],
    );
  });
  it('quarantines poison messages after three retries', async () => {
    const { channel, run } = harness(undefined, 3);
    await expect(run(new Error('poison message'))).rejects.toThrow();
    expect(channel.sendToQueue.mock.calls[0][0]).toBe('orders.dead');
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });
});
