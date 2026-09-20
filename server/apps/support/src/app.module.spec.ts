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

  it('imports the database and the notifications client', () => {
    const imported = metadata('imports').map((entry) =>
      typeof entry === 'function' ? entry : ((entry as { module?: unknown })?.module ?? entry),
    );

    expect(imported).toEqual(expect.arrayContaining([PrismaModule, RabbitmqClientModule]));
  });
});
