import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@chicago-pizza/prisma';
import { AuditModule, baseEnvSchema, RedisModule, RMQ_QUEUES, validateEnv } from '@chicago-pizza/common';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { OrdersController } from './orders.controller';
import { AnalyticsService } from './services/analytics.service';
import { CartService } from './services/cart.service';
import { OrderService } from './services/order.service';
import { PromocodeService } from './services/promocode.service';
import { LoyaltyService } from './services/loyalty.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (raw) => validateEnv(baseEnvSchema, raw) }),
    PrismaModule,
    RedisModule,
    AuditModule,
    RabbitmqClientModule.register([
      { name: 'PRODUCTS_SERVICE', queue: RMQ_QUEUES.PRODUCTS },
      { name: 'NOTIFICATIONS_SERVICE', queue: RMQ_QUEUES.NOTIFICATIONS },
      // A queue hands each message to one consumer, so an event that needs
      // both an email and a live push has to be published to both.
      { name: 'REALTIME_SERVICE', queue: RMQ_QUEUES.REALTIME },
    ]),
  ],
  controllers: [OrdersController],
  providers: [AnalyticsService, CartService, OrderService, PromocodeService, LoyaltyService],
})
export class AppModule {}
