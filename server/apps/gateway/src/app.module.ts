import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '@chicago-pizza/prisma';
import {
  CorrelationIdMiddleware,
  HealthModule,
  JwtAuthGuard,
  JwtStrategy,
  REDIS_CLIENT,
  RedisModule,
  RedisThrottlerStorage,
  RMQ_QUEUES,
  RolesGuard,
} from '@chicago-pizza/common';
import Redis from 'ioredis';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { loadGatewayEnv } from './config/env';
import { AuthController } from './controllers/auth.controller';
import { CatalogController } from './controllers/catalog.controller';
import { OrdersController } from './controllers/orders.controller';
import { SupportController } from './controllers/support.controller';
import { AdminController } from './controllers/admin.controller';
import { RealtimeGateway } from './realtime/realtime.gateway';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadGatewayEnv }),
    PrismaModule,
    // The session-revocation list lives in Redis and is read on every request.
    RedisModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_ACCESS_SECRET') }),
    }),
    // Global rate limit: 100 requests per minute per IP, per the security spec.
    // Counters live in Redis, not in the process: the in-memory default gave
    // every replica its own budget and handed out a fresh one on restart.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL_SECONDS')! * 1000,
            limit: config.get<number>('THROTTLE_LIMIT')!,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    RabbitmqClientModule.register([
      { name: 'AUTH_SERVICE', queue: RMQ_QUEUES.AUTH },
      { name: 'PRODUCTS_SERVICE', queue: RMQ_QUEUES.PRODUCTS },
      { name: 'ORDERS_SERVICE', queue: RMQ_QUEUES.ORDERS },
      { name: 'SUPPORT_SERVICE', queue: RMQ_QUEUES.SUPPORT },
      { name: 'NOTIFICATIONS_SERVICE', queue: RMQ_QUEUES.NOTIFICATIONS },
    ]),
    HealthModule,
  ],
  controllers: [AuthController, CatalogController, OrdersController, SupportController, AdminController],
  providers: [
    JwtStrategy,
    RealtimeGateway,
    // Order matters: throttle first, then authenticate, then authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // First thing in the chain: everything logged after this point, in this
    // service and in the ones it calls over RabbitMQ, carries the same id.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
