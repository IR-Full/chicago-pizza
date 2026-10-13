import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * The rate limiter, restricted to HTTP.
 *
 * `ThrottlerGuard` reads `req.ips` / `req.ip` to decide whom to count. In a
 * RabbitMQ handler there is no request — `switchToHttp()` hands back the
 * event payload instead — and the guard dies on the first internal event the
 * gateway consumes. Rate limiting belongs on the public edge anyway: the
 * broker is not reachable from outside, and throttling our own services would
 * drop domain events on the floor.
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }
}
