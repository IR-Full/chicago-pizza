import { HttpException, HttpStatus } from '@nestjs/common';
import { catchError, firstValueFrom, Observable, throwError, timeout } from 'rxjs';
import { RpcErrorPayload } from './rpc-exception.filter';
import { CORRELATION_ID_HEADER, currentCorrelationId } from '../observability/correlation';

const DEFAULT_RPC_TIMEOUT_MS = 10_000;

/**
 * The one method of `ClientProxy` this helper uses.
 *
 * Taking `ClientProxy` itself read better but coupled every caller to *this*
 * copy of `@nestjs/microservices`. npm installs a copy per workspace, the
 * class has a protected member, and TypeScript compares classes with
 * protected members nominally — so the proxy Nest injected in the gateway was
 * "not assignable" to the identical class imported here. Depending on the
 * call shape instead of the class makes the helper immune to that, and says
 * more honestly what it needs.
 */
export interface RpcClient {
  send<TResult, TPayload>(pattern: string, data: TPayload): Observable<TResult>;
}

/**
 * Gateway-side helper: performs a request/response call over RabbitMQ and
 * rebuilds the original HTTP status from the microservice's error payload.
 */
export async function rpcSend<TResult, TPayload = unknown>(
  client: RpcClient,
  pattern: string,
  payload: TPayload,
  timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
): Promise<TResult> {
  // The id rides inside the message: RabbitMQ carries no ambient context, so
  // without this the trail stops at the gateway.
  const correlationId = currentCorrelationId();
  const envelope =
    correlationId && payload && typeof payload === 'object'
      ? ({ ...payload, [CORRELATION_ID_HEADER]: correlationId } as TPayload)
      : payload;

  return firstValueFrom(
    client.send<TResult, TPayload>(pattern, envelope).pipe(
      timeout(timeoutMs),
      catchError((error) => throwError(() => toHttpException(error))),
    ),
  );
}

function toHttpException(error: unknown): HttpException {
  const candidate = error as Partial<RpcErrorPayload> & { name?: string; message?: string };

  if (candidate?.name === 'TimeoutError') {
    return new HttpException('Upstream service did not respond in time', HttpStatus.GATEWAY_TIMEOUT);
  }

  if (typeof candidate?.statusCode === 'number') {
    return new HttpException(candidate.message ?? 'Request failed', candidate.statusCode);
  }

  return new HttpException(candidate?.message ?? 'Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
}
