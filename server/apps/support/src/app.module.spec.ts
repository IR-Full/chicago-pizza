import { PrismaModule } from '@chicago-pizza/prisma';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { SupportController } from './support.controller';
import { SupportService } from './services/support.service';

// `ConfigModule.forRoot({ validate })` runs the schema when the module file is
// evaluated, so the environment must exist before the require below.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pizza',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
});

const { AppModule } = require('./app.module') as typeof import('./app.module');

const metadata = (key: string): unknown[] => (Reflect.getMetadata(key, AppModule) as unknown[]) ?? [];

describe('support AppModule', () => {
  it('exposes the microservice controller', () => {
    expect(metadata('controllers')).toEqual([SupportController]);
  });

  it('provides the support service', () => {
    expect(metadata('providers')).toEqual([SupportService]);
  });

  /**
   * `SupportService` injects both brokers by token, and a token the module
   * never registers is a container that refuses to build — at boot, not at
   * compile time. The service's own tests pass constructor doubles straight
   * in, so they cannot see this; only the wiring can.
   */
  it('registers every broker client the service injects', () => {
    const tokens = (metadata('imports') as { imports?: { providers?: { provide?: unknown }[] }[] }[])
      .flatMap((entry) => (entry as { imports?: unknown[] })?.imports ?? [])
      .flatMap((inner) => ((inner as { providers?: { provide?: unknown }[] })?.providers ?? []))
      .map((provider) => provider.provide);

    expect(tokens).toEqual(expect.arrayContaining(['NOTIFICATIONS_SERVICE', 'REALTIME_SERVICE']));
  });

  it('imports the database and the notifications client', () => {
    const imported = metadata('imports').map((entry) =>
      typeof entry === 'function' ? entry : ((entry as { module?: unknown })?.module ?? entry),
    );

    expect(imported).toEqual(expect.arrayContaining([PrismaModule, RabbitmqClientModule]));
  });
});
