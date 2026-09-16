import { HttpException, HttpStatus } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { of, throwError, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { rpcSend } from './rpc.helpers';

function clientThat(behaviour: () => unknown): ClientProxy {
  return { send: jest.fn(() => behaviour()) } as unknown as ClientProxy;
}

/**
 * The gateway's only bridge to the microservices: it has to turn whatever
 * comes back over RabbitMQ into an HTTP status the browser can act on.
 */
describe('rpcSend', () => {
  it('resolves with the payload the microservice returned', async () => {
    const client = clientThat(() => of({ id: 'order-1' }));

    await expect(rpcSend(client, 'orders.get', { id: 'order-1' })).resolves.toEqual({ id: 'order-1' });
    expect(client.send).toHaveBeenCalledWith('orders.get', { id: 'order-1' });
  });

  it('rebuilds the original HTTP status from the error payload', async () => {
    const client = clientThat(() => throwError(() => ({ statusCode: 404, message: 'Заказ не найден' })));

    await expect(rpcSend(client, 'orders.get', {})).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      message: 'Заказ не найден',
    });
  });

  it.each([
    [HttpStatus.BAD_REQUEST, 'Некорректный размер'],
    [HttpStatus.FORBIDDEN, 'Нет доступа'],
    [HttpStatus.CONFLICT, 'Email уже занят'],
  ])('preserves status %s', async (statusCode, message) => {
    const client = clientThat(() => throwError(() => ({ statusCode, message })));

    await expect(rpcSend(client, 'pattern', {})).rejects.toMatchObject({ status: statusCode, message });
  });

  it('falls back to 500 when the error carries no status', async () => {
    const client = clientThat(() => throwError(() => new Error('socket hang up')));

    await expect(rpcSend(client, 'pattern', {})).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'socket hang up',
    });
  });

  it('uses a generic message when the error is empty', async () => {
    const client = clientThat(() => throwError(() => null));

    await expect(rpcSend(client, 'pattern', {})).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  });

  it('uses a generic message when a status arrives without one', async () => {
    const client = clientThat(() => throwError(() => ({ statusCode: 409 })));

    await expect(rpcSend(client, 'pattern', {})).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      message: 'Request failed',
    });
  });

  it('turns a silent upstream into 504 instead of hanging the request', async () => {
    const client = clientThat(() => timer(50).pipe(map(() => 'too late')));

    await expect(rpcSend(client, 'pattern', {}, 5)).rejects.toMatchObject({
      status: HttpStatus.GATEWAY_TIMEOUT,
    });
  });

  it('always rejects with an HttpException so Nest can serialise it', async () => {
    const client = clientThat(() => throwError(() => ({ statusCode: 418, message: 'teapot' })));

    await expect(rpcSend(client, 'pattern', {})).rejects.toBeInstanceOf(HttpException);
  });
});
