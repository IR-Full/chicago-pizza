import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@chicago-pizza/prisma';
import { baseEnvSchema, RedisModule, RMQ_QUEUES, validateEnv } from '@chicago-pizza/common';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { OrdersController } from './orders.controller';
import { CartService } from './services/cart.service';
import { OrderService } from './services/order.service';
import { PromocodeService } from './services/promocode.service';
import { LoyaltyService } from './services/loyalty.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (raw) => validateEnv(baseEnvSchema, raw) }),
    PrismaModule,
    RedisModule,
    RabbitmqClientModule.register([
      { name: 'PRODUCTS_SERVICE', queue: RMQ_QUEUES.PRODUCTS },
      { name: 'NOTIFICATIONS_SERVICE', queue: RMQ_QUEUES.NOTIFICATIONS },
    ]),
  ],
  controllers: [OrdersController],
  providers: [CartService, OrderService, PromocodeService, LoyaltyService],
})
export class AppModule {}
