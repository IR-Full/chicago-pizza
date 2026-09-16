import { PrismaModule } from '@chicago-pizza/prisma';
import { RedisModule } from '@chicago-pizza/common';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { AddressService } from './services/address.service';
import { TokenService } from './services/token.service';
import { loadAuthEnv } from './config/env';

// `ConfigModule.forRoot({ validate })` runs the schema the moment the module
// file is evaluated, so the environment has to exist before the require below.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pizza',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
  JWT_ACCESS_SECRET: 'access-secret-long-enough',
  JWT_REFRESH_SECRET: 'refresh-secret-long-enough',
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('./app.module') as typeof import('./app.module');

/**
 * Asserted on metadata rather than by booting: instantiating the module would
 * open real Redis and RabbitMQ connections. What can still break silently is
 * the wiring itself — a provider dropped from the list only fails at runtime.
 */
const metadata = (key: string): unknown[] => (Reflect.getMetadata(key, AppModule) as unknown[]) ?? [];

const importedModules = () =>
  metadata('imports').map((entry) =>
    typeof entry === 'function' ? entry : ((entry as { module?: unknown })?.module ?? entry),
  );

describe('auth AppModule', () => {
  it('exposes the microservice controller', () => {
    expect(metadata('controllers')).toEqual([AuthController]);
  });

  it('provides every service the controller injects', () => {
    expect(metadata('providers')).toEqual(expect.arrayContaining([AuthService, AddressService, TokenService]));
  });

  it('imports the database, cache and broker client', () => {
    expect(importedModules()).toEqual(expect.arrayContaining([PrismaModule, RedisModule, RabbitmqClientModule]));
  });

  it('refuses to boot on an empty environment', () => {
    expect(() => loadAuthEnv({} as NodeJS.ProcessEnv)).toThrow(/Invalid environment configuration/);
  });
});
