import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';

export interface RpcErrorPayload {
  statusCode: number;
  message: string;
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
