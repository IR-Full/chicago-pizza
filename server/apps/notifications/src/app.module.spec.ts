import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '@chicago-pizza/prisma';
import { NotificationsController } from './notifications.controller';
import { NotificationService, EMAIL_QUEUE } from './services/notification.service';
import { MailerService } from './services/mailer.service';
import { EmailProcessor } from './processors/email.processor';

// `ConfigModule.forRoot({ validate })` runs the schema when the module file is
// evaluated, so the environment must exist before the require below.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pizza',
  REDIS_URL: 'redis://:s3cret@cache:6380',
  RABBITMQ_URL: 'amqp://localhost:5672',
  SMTP_HOST: 'mailhog',
});

const { AppModule } = require('./app.module') as typeof import('./app.module');

const metadata = (key: string): unknown[] => (Reflect.getMetadata(key, AppModule) as unknown[]) ?? [];

/** The BullMQ root registration, pulled back out of the dynamic module. */
function bullFactory() {
  const dynamic = metadata('imports').find(
    (entry) => (entry as { module?: { name?: string } })?.module?.name === 'BullModule',
  ) as { providers?: { useFactory?: (config: ConfigService) => unknown; inject?: unknown[] }[] } | undefined;

  return dynamic?.providers?.find((provider) => typeof provider.useFactory === 'function')?.useFactory;
}

describe('notifications AppModule', () => {
  it('exposes the microservice controller', () => {
    expect(metadata('controllers')).toEqual([NotificationsController]);
  });

  it('provides the notification service, mailer and queue worker', () => {
    expect(metadata('providers')).toEqual(
      expect.arrayContaining([NotificationService, MailerService, EmailProcessor]),
    );
  });

  it('imports the database', () => {
    const imported = metadata('imports').map((entry) =>
      typeof entry === 'function' ? entry : ((entry as { module?: unknown })?.module ?? entry),
    );

    expect(imported).toContain(PrismaModule);
  });

  it('splits REDIS_URL into the host, port and password BullMQ expects', () => {
    const factory = bullFactory();
    expect(factory).toBeDefined();

    const config = { get: jest.fn(() => 'redis://:s3cret@cache:6380') } as unknown as ConfigService;

    // BullMQ takes a connection object, not a url — a wrong split here means
    // the worker silently connects to localhost instead of the real cache.
    expect(factory!(config)).toEqual({ connection: { host: 'cache', port: 6380, password: 's3cret' } });
  });

  it('falls back to the default port and no password', () => {
    const factory = bullFactory();
    const config = { get: jest.fn(() => 'redis://cache') } as unknown as ConfigService;

    expect(factory!(config)).toEqual({ connection: { host: 'cache', port: 6379, password: undefined } });
  });

  it('registers the email queue the service enqueues onto', () => {
    expect(EMAIL_QUEUE).toBe('email');
  });
});
