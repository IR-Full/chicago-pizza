import { ArgumentsHost, BadRequestException, ForbiddenException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostFor(url = '/api/orders', method = 'POST') {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url, method }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => logError.mockRestore());

  it('keeps the status and body of a thrown HttpException', () => {
    const { host, status, json } = hostFor();

    filter.catch(new BadRequestException('Некорректный размер'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message: 'Некорректный размер', path: '/api/orders' }),
    );
  });

  it.each([
    [new ForbiddenException('Нет доступа'), 403],
    [new HttpException('Teapot', 418), 418],
  ])('maps %#', (exception, expected) => {
    const { host, status } = hostFor();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(expected);
  });

  it('spreads a structured validation body into the response', () => {
    const { host, json } = hostFor();

    filter.catch(new BadRequestException({ message: ['email must be an email'], error: 'Bad Request' }), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: ['email must be an email'], error: 'Bad Request' }),
    );
  });

  it('hides the details of an unexpected error behind a 500', () => {
    const { host, status, json } = hostFor();

    filter.catch(new Error('connect ECONNREFUSED 10.0.0.2:5432'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Internal server error' }));
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('ECONNREFUSED');
  });

  it('logs the stack of an unexpected error with its route', () => {
    const { host } = hostFor('/api/cart', 'GET');

    filter.catch(new Error('boom'), host);

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('GET /api/cart'), expect.any(String));
  });

  it('does not log expected HTTP exceptions', () => {
    const { host } = hostFor();

    filter.catch(new ForbiddenException(), host);

    expect(logError).not.toHaveBeenCalled();
  });

  it('always includes the path and an ISO timestamp', () => {
    const { host, json } = hostFor('/api/products');

    filter.catch(new BadRequestException(), host);

    const body = json.mock.calls[0][0];
    expect(body.path).toBe('/api/products');
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it('survives a non-Error throwable', () => {
    const { host, status, json } = hostFor();

    filter.catch('something went wrong', host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Internal server error' }));
  });
});
