import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

function contextFor(method = 'GET', url = '/api/products'): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ method, url }) }) } as unknown as ExecutionContext;
}

const handlerOf = (source: unknown): CallHandler => ({ handle: () => source }) as CallHandler;

describe('LoggingInterceptor', () => {
  const interceptor = new LoggingInterceptor();
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
    warn.mockRestore();
  });

  it('passes the handler result through untouched', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(contextFor(), handlerOf(of({ items: [] }))) as never,
    );

    expect(result).toEqual({ items: [] });
  });

  it('logs the method, path and duration of a successful call', async () => {
    await firstValueFrom(interceptor.intercept(contextFor('POST', '/api/cart'), handlerOf(of('ok'))) as never);

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^POST \/api\/cart \d+ms$/));
  });

  it('warns with the error message when the handler fails', async () => {
    const failing = interceptor.intercept(contextFor('GET', '/api/orders'), handlerOf(throwError(() => new Error('boom'))));

    await expect(firstValueFrom(failing as never)).rejects.toThrow('boom');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GET /api/orders'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('does not log a success line for a failed call', async () => {
    const failing = interceptor.intercept(contextFor(), handlerOf(throwError(() => new Error('boom'))));

    await expect(firstValueFrom(failing as never)).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
  });
});
