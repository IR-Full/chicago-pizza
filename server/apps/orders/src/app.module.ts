import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@chicago-pizza/prisma';
import { AuditModule, RedisModule, RMQ_QUEUES, validateEnv } from '@chicago-pizza/common';
import { ordersEnvSchema } from './config/env';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { OrdersController } from './orders.controller';
import { AnalyticsService } from './services/analytics.service';
import { CartService } from './services/cart.service';
import { OutboxService } from './services/outbox.service';
import { OrderService } from './services/order.service';
import { OrderExpiryService } from './services/order-expiry.service';
import { PromocodeService } from './services/promocode.service';
import { LoyaltyService } from './services/loyalty.service';
import { PaymentService } from './services/payment.service';
import { YooKassaProvider } from './services/yookassa.provider';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (raw) => validateEnv(ordersEnvSchema, raw) }),
    PrismaModule,
    RedisModule,
    AuditModule,
    // Drives the sweep that cancels online orders nobody paid for.
    ScheduleModule.forRoot(),
    RabbitmqClientModule.register([
      { name: 'PRODUCTS_SERVICE', queue: RMQ_QUEUES.PRODUCTS },
      { name: 'NOTIFICATIONS_SERVICE', queue: RMQ_QUEUES.NOTIFICATIONS },
      // A queue hands each message to one consumer, so an event that needs
      // both an email and a live push has to be published to both.
      { name: 'REALTIME_SERVICE', queue: RMQ_QUEUES.REALTIME },
    ]),
  ],
  controllers: [OrdersController],
  providers: [
    AnalyticsService,
    CartService,
    OrderService,
    OutboxService,
    OrderExpiryService,
    PaymentService,
    PromocodeService,
    LoyaltyService,
    YooKassaProvider,
  ],
})
export class AppModule {}
