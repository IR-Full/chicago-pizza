import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { catchError, defer, Observable, tap } from 'rxjs';

@Injectable()
export class RmqAckInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();
    const rmq = context.switchToRpc().getContext<RmqContext>();
    const channel = rmq.getChannelRef();
    const message = rmq.getMessage();
    let settled = false;
    const ack = () => {
      if (!settled) {
        channel.ack(message);
        settled = true;
      }
    };
    return next.handle().pipe(
      tap({ complete: ack }),
      catchError((error: unknown) =>
        defer(async () => {
          // RPC callers receive the error and own retry; never replay commands
          // invisibly. Legacy events retry three times then enter a durable DLQ.
          if (message.properties.replyTo || error instanceof HttpException) {
            ack();
            throw error;
          }
          try {
            const attempts = Number(message.properties.headers?.['x-retries'] ?? 0);
            const queue = attempts < 3 ? message.fields.routingKey : `${message.fields.routingKey}.dead`;
            await channel.assertQueue(queue, { durable: true });
            await new Promise<void>((resolve, reject) => {
              channel.sendToQueue(
                queue,
                message.content,
                {
                  persistent: true,
                  headers: { ...message.properties.headers, 'x-retries': attempts + 1 },
                },
                (err: Error | null) => (err ? reject(err) : resolve()),
              );
            });
            ack();
          } catch (publishError) {
            if (!settled) {
              channel.nack(message, false, true);
              settled = true;
            }
            throw publishError;
          }
          throw error;
        }),
      ),
    );
  }
}
