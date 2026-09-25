import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // The gateway is a hybrid application: besides HTTP it consumes domain
    // events off RabbitMQ, which carry no request, no cookie and no user.
    // Those handlers are internal — the broker is not reachable from outside
    // — so an HTTP guard has nothing to decide here and must not try to read
    // a request that does not exist.
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      // `@Public()` means "authentication optional", not "ignore the token".
      // We still try to populate `request.user` so routes like the catalog or
      // recommendations can personalise for a signed-in visitor while
      // remaining fully usable for a guest.
      try {
        await super.canActivate(context);
      } catch {
        // An absent, malformed or expired token is fine here.
      }
      return true;
    }

    return (await super.canActivate(context)) as boolean;
  }
}
