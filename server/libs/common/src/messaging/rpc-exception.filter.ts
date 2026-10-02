import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';

export interface RpcErrorPayload {
  statusCode: number;
  message: string;
}

/**
 * The Prisma error codes that describe a *request*, not a broken server.
 *
 * Everything the database refused used to arrive at the browser as
 * "Internal server error", because only `HttpException` was recognised here.
 * Adding a favourite with an id that does not exist is a 500 under that rule —
 * a foreign-key violation, reported as though the shop had fallen over. The
 * customer gets no idea what to do differently, and the log fills with
 * stack traces for what is in fact a 404.
 *
 * Deliberately a short list. These three have an unambiguous HTTP reading;
 * anything else really is unexpected and should stay a 500 with a stack trace,
 * because guessing at a status for an error nobody has thought about is how a
 * genuine fault gets dressed up as the client's fault.
 */
const PRISMA_STATUS: Record<string, { status: HttpStatus; message: string }> = {
  // Unique constraint: the row is already there.
  P2002: { status: HttpStatus.CONFLICT, message: 'Такая запись уже существует' },
  // Foreign key: something this row points at does not exist.
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'Ссылка на несуществующую запись' },
  // `update`/`delete` matched nothing.
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Запись не найдена' },
};

/** True for a `PrismaClientKnownRequestError` without importing Prisma here. */
function prismaErrorCode(exception: unknown): string | null {
  const candidate = exception as { name?: string; code?: unknown };
  if (candidate?.name !== 'PrismaClientKnownRequestError') return null;
  return typeof candidate.code === 'string' ? candidate.code : null;
}

/**
 * Microservice-side filter. Domain code throws ordinary Nest HttpExceptions;
 * this converts them into a serializable payload so the gateway can rebuild
 * the same HTTP status for the browser instead of collapsing everything
 * into a generic 500.
 *
 * The observable must error with a **plain object**, not an RpcException
 * instance: once a filter has handled the error, Nest serializes whatever the
 * observable emits directly. An Error subclass survives JSON only as its
 * `message`, so `statusCode` would be lost and every domain error would reach
 * the client as a 500.
 */
@Catch()
export class RpcExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('RpcException');

  catch(exception: unknown, _host: ArgumentsHost): Observable<never> {
    return throwError(() => this.toPayload(exception));
  }

  private toPayload(exception: unknown): RpcErrorPayload {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : Array.isArray((response as { message?: string[] }).message)
            ? (response as { message: string[] }).message.join('; ')
            : ((response as { message?: string }).message ?? exception.message);

      return { statusCode: exception.getStatus(), message };
    }

    const prismaCode = prismaErrorCode(exception);
    if (prismaCode && PRISMA_STATUS[prismaCode]) {
      const { status, message } = PRISMA_STATUS[prismaCode];
      // Logged at warn, not error: it is a refusal, but one worth noticing —
      // a constraint the application should usually have checked itself.
      this.logger.warn(`Prisma ${prismaCode} → ${status}`);
      // The provider's own message names tables and columns, so it is not the
      // one the customer sees.
      return { statusCode: status, message };
    }

    if (exception instanceof RpcException) {
      const error = exception.getError();
      if (typeof error === 'object' && error !== null && 'statusCode' in error) {
        return error as RpcErrorPayload;
      }
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: typeof error === 'string' ? error : exception.message,
      };
    }

    this.logger.error('Unhandled microservice exception', (exception as Error)?.stack);
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }
}
