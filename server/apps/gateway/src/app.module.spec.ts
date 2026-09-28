import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { RedisThrottlerStorage } from '@chicago-pizza/common';
import { PrismaModule } from '@chicago-pizza/prisma';
import { HealthModule, HttpThrottlerGuard, JwtAuthGuard, JwtStrategy, RolesGuard } from '@chicago-pizza/common';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { AuthController } from './controllers/auth.controller';
import { CatalogController } from './controllers/catalog.controller';
import { OrdersController } from './controllers/orders.controller';
import { SupportController } from './controllers/support.controller';
import { AdminController } from './controllers/admin.controller';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { RealtimeEventsController } from './realtime/realtime-events.controller';

// `ConfigModule.forRoot({ validate })` runs the schema when the module file is
// evaluated, so the environment must exist before the require below.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pizza',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
  JWT_ACCESS_SECRET: 'access-secret-long-enough',
});

const { AppModule } = require('./app.module') as typeof import('./app.module');

const metadata = (key: string): any[] => (Reflect.getMetadata(key, AppModule) as any[]) ?? [];

const dynamicNamed = (name: string) =>
  metadata('imports').find((entry) => entry?.module?.name === name) as
    | { providers?: { useFactory?: (...args: any[]) => any }[] }
    | undefined;

const config = (values: Record<string, unknown>) =>
  ({ get: jest.fn((key: string) => values[key]) }) as unknown as ConfigService;

describe('gateway AppModule — wiring', () => {
  it('exposes every public controller, plus the event consumer', () => {
    expect(metadata('controllers')).toEqual([
      AuthController,
      CatalogController,
      OrdersController,
      SupportController,
      AdminController,
      // Not reachable over HTTP: it listens on RabbitMQ and turns domain
      // events into WebSocket pushes.
      RealtimeEventsController,
    ]);
  });

  it('provides the passport strategy and the websocket gateway', () => {
    expect(metadata('providers')).toEqual(expect.arrayContaining([JwtStrategy, RealtimeGateway]));
  });

  it('imports the database, broker clients and health checks', () => {
    const imported = metadata('imports').map((entry) =>
      typeof entry === 'function' ? entry : (entry?.module ?? entry),
    );

    expect(imported).toEqual(expect.arrayContaining([PrismaModule, RabbitmqClientModule, HealthModule]));
  });
});

describe('gateway AppModule — guard order', () => {
  it('throttles first, then authenticates, then authorises', () => {
    // Reversing these would let an unauthenticated flood reach the JWT
    // verification, or run role checks before the user is resolved.
    const guards = metadata('providers')
      .filter((provider) => provider?.provide === APP_GUARD)
      .map((provider) => provider.useClass);

    // `HttpThrottlerGuard`, not `ThrottlerGuard`: the gateway now also
    // consumes events, and the stock guard dies looking for `req.ip` on them.
    expect(guards).toEqual([HttpThrottlerGuard, JwtAuthGuard, RolesGuard]);
  });
});

describe('gateway AppModule — configuration factories', () => {
  it('signs and verifies with the access-token secret', () => {
    const factory = dynamicNamed('JwtModule')?.providers?.find((p) => p.useFactory)?.useFactory;

    expect(factory).toBeDefined();
    expect(factory!(config({ JWT_ACCESS_SECRET: 'access-secret-long-enough' }))).toEqual({
      secret: 'access-secret-long-enough',
    });
  });

  it('converts the throttle window from seconds to milliseconds', () => {
    const factory = dynamicNamed('ThrottlerModule')?.providers?.find((p) => p.useFactory)?.useFactory;

    expect(factory).toBeDefined();
    // The env is in seconds for operators; the library expects milliseconds.
    // The storage registers its Lua as a named command on the client (EVALSHA
    // rather than shipping the script per request), so the stub has to offer it.
    const redis = { defineCommand: jest.fn() } as never;
    const options = factory!(config({ THROTTLE_TTL_SECONDS: 60, THROTTLE_LIMIT: 100 }), redis);

    expect(options.throttlers).toEqual([{ ttl: 60_000, limit: 100 }]);
    // Counters must be shared: the in-memory default gave every replica its
    // own budget and reset it on restart.
    expect(options.storage).toBeInstanceOf(RedisThrottlerStorage);
  });
});
