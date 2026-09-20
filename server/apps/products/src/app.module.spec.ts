import { PrismaModule } from '@chicago-pizza/prisma';
import { REDIS_CLIENT, RedisCacheService, RedisModule } from '@chicago-pizza/common';
import { ProductsController } from './products.controller';
import { CatalogService } from './services/catalog.service';
import { PricingService } from './services/pricing.service';

// `ConfigModule.forRoot({ validate })` runs the schema when the module file is
// evaluated, so the environment must exist before the require below.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pizza',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
});

const { AppModule } = require('./app.module') as typeof import('./app.module');

const metadata = (key: string): unknown[] => (Reflect.getMetadata(key, AppModule) as unknown[]) ?? [];

describe('products AppModule', () => {
  it('exposes the microservice controller', () => {
    expect(metadata('controllers')).toEqual([ProductsController]);
  });

  it('provides the catalog and pricing services', () => {
    expect(metadata('providers')).toEqual(expect.arrayContaining([CatalogService, PricingService]));
  });

  it('imports the database and the cache', () => {
    const imported = metadata('imports').map((entry) =>
      typeof entry === 'function' ? entry : ((entry as { module?: unknown })?.module ?? entry),
    );

    expect(imported).toEqual(expect.arrayContaining([PrismaModule, RedisModule]));
  });
});

/**
 * Regression guard for a circular-import bug: `REDIS_CLIENT` used to be
 * exported from `redis.module.ts`, which imported `RedisCacheService`, which
 * imported the token back. At runtime the token evaluated to `undefined`
 * inside `@Inject()` and every service depending on Redis crash-looped with
 * "Nest can't resolve dependencies of the RedisCacheService".
 *
 * TypeScript cannot catch this — only the emitted metadata shows it.
 */
describe('Redis provider wiring', () => {
  it('exposes a defined injection token', () => {
    expect(REDIS_CLIENT).toBeDefined();
    expect(typeof REDIS_CLIENT).toBe('string');
  });

  it('records the token in RedisCacheService constructor metadata', () => {
    // `@Inject(token)` stores the token under this key; `undefined` here is
    // exactly the failure mode the cycle produced.
    const injected = Reflect.getMetadata('self:paramtypes', RedisCacheService) as
      | { index: number; param: unknown }[]
      | undefined;

    expect(injected).toBeDefined();
    expect(injected?.[0]?.param).toBe(REDIS_CLIENT);
  });
});
