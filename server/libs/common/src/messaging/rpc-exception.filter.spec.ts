import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { RpcExceptionFilter, RpcErrorPayload } from './rpc-exception.filter';

/**
 * The whole point of this filter is that the HTTP status survives the trip
 * over RabbitMQ. It previously emitted an RpcException instance, which JSON
 * reduces to `{ message }` — so a 400 reached the browser as a 500.
 * Every assertion below checks the payload is a plain, JSON-safe object.
 */
async function captureError(exception: unknown): Promise<RpcErrorPayload> {
  const filter = new RpcExceptionFilter();
  try {
    await firstValueFrom(filter.catch(exception, {} as never));
    throw new Error('expected the observable to error');
  } catch (error) {
    return error as RpcErrorPayload;
  }
}

describe('RpcExceptionFilter', () => {
  it.each([
    [new BadRequestException('Нельзя перевести заказ'), 400],
    [new NotFoundException('Заказ не найден'), 404],
    [new ForbiddenException('Нет доступа'), 403],
  ])('preserves the status of %p', async (exception, expectedStatus) => {
    const payload = await captureError(exception);
    expect(payload.statusCode).toBe(expectedStatus);
  });

  it('emits a plain object that survives JSON serialization', async () => {
    const payload = await captureError(new BadRequestException('boom'));
    const roundTripped = JSON.parse(JSON.stringify(payload)) as RpcErrorPayload;

    // This is exactly what the transport does to the payload.
    expect(roundTripped.statusCode).toBe(400);
    expect(roundTripped.message).toBe('boom');
  });

  it('flattens class-validator message arrays into one string', async () => {
    const payload = await captureError(
      new BadRequestException({ message: ['email must be an email', 'password too short'] }),
    );

    expect(payload.message).toBe('email must be an email; password too short');
  });

  it('passes through an RpcException that already carries a statusCode', async () => {
    const payload = await captureError(new RpcException({ statusCode: 409, message: 'conflict' }));

    expect(payload).toEqual({ statusCode: 409, message: 'conflict' });
  });

  it('turns an unexpected error into a 500 without leaking internals', async () => {
    const payload = await captureError(new Error('Prisma connection string: postgres://secret'));

    expect(payload.statusCode).toBe(500);
    expect(payload.message).toBe('Internal server error');
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('keeps the message of a string RpcException and marks it a 500', async () => {
    const payload = await captureError(new RpcException('cart is empty'));

    expect(payload).toEqual({ statusCode: 500, message: 'cart is empty' });
  });

  it('falls back to the exception message when an RpcException wraps a bare object', async () => {
    const payload = await captureError(new RpcException({ reason: 'unknown' } as never));

    expect(payload.statusCode).toBe(500);
    expect(typeof payload.message).toBe('string');
  });

  it('keeps a string HttpException body as the message', async () => {
    const payload = await captureError(new BadRequestException('plain string body'));

    expect(payload).toEqual({ statusCode: 400, message: 'plain string body' });
  });

  it('falls back to the exception message when the body carries none', async () => {
    // Nest builds this shape for `new ForbiddenException()` with no argument.
    const payload = await captureError(new ForbiddenException({ error: 'Forbidden' }));

    expect(payload.statusCode).toBe(403);
    expect(payload.message).toBe(new ForbiddenException({ error: 'Forbidden' }).message);
  });

  it('survives an RpcException whose error is null', async () => {
    const payload = await captureError(new RpcException(null as never));

    expect(payload.statusCode).toBe(500);
    expect(typeof payload.message).toBe('string');
  });
});
