import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { redactUrl } from '../logging/redact';
import { currentCorrelationId } from '../observability/correlation';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method: string; url: string }>();
    const { method } = request;
    // The raw URL carries password-reset tokens, verification codes and
    // whatever the customer typed into search — none of which belongs in a
    // log file that outlives the request by months.
    const url = redactUrl(request.url);
    const start = Date.now();

    // The id lets one grep follow a request from the gateway through
    // RabbitMQ into whichever service actually failed.
    const correlationId = currentCorrelationId();
    const tag = correlationId ? `[${correlationId}] ` : '';

    return next.handle().pipe(
      tap({
        next: () => this.logger.log(`${tag}${method} ${url} ${Date.now() - start}ms`),
        error: (error: Error) =>
          this.logger.warn(`${tag}${method} ${url} ${Date.now() - start}ms — ${error.message}`),
      }),
    );
  }
}
