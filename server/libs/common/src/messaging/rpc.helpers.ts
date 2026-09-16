import { HttpException, HttpStatus } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { catchError, firstValueFrom, throwError, timeout } from 'rxjs';
import { RpcErrorPayload } from './rpc-exception.filter';

const DEFAULT_RPC_TIMEOUT_MS = 10_000;

/**
 * Gateway-side helper: performs a request/response call over RabbitMQ and
 * rebuilds the original HTTP status from the microservice's error payload.
 */
export async function rpcSend<TResult, TPayload = unknown>(
  client: ClientProxy,
  pattern: string,
  payload: TPayload,
  timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
): Promise<TResult> {
  return firstValueFrom(
    client.send<TResult, TPayload>(pattern, payload).pipe(
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
