import { PrismaModule } from '@chicago-pizza/prisma';
import { RedisModule } from '@chicago-pizza/common';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { OrdersController } from './orders.controller';
import { CartService } from './services/cart.service';
import { OrderService } from './services/order.service';
import { PromocodeService } from './services/promocode.service';
import { LoyaltyService } from './services/loyalty.service';

// `ConfigModule.forRoot({ validate })` runs the schema when the module file is
// evaluated, so the environment must exist before the require below.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/pizza',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
});

const { AppModule } = require('./app.module') as typeof import('./app.module');

const metadata = (key: string): unknown[] => (Reflect.getMetadata(key, AppModule) as unknown[]) ?? [];

describe('orders AppModule', () => {
  it('exposes the microservice controller', () => {
    expect(metadata('controllers')).toEqual([OrdersController]);
  });

  it('provides cart, order, promocode and loyalty services', () => {
    expect(metadata('providers')).toEqual(
      expect.arrayContaining([CartService, OrderService, PromocodeService, LoyaltyService]),
    );
  });

  it('imports the database, cache and broker clients', () => {
    const imported = metadata('imports').map((entry) =>
      typeof entry === 'function' ? entry : ((entry as { module?: unknown })?.module ?? entry),
    );

    expect(imported).toEqual(expect.arrayContaining([PrismaModule, RedisModule, RabbitmqClientModule]));
  });
});
