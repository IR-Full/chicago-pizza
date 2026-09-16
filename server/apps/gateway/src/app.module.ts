import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '@chicago-pizza/prisma';
import {
  HealthModule,
  JwtAuthGuard,
  JwtStrategy,
  RMQ_QUEUES,
  RolesGuard,
} from '@chicago-pizza/common';
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
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_ACCESS_SECRET') }),
    }),
    // Global rate limit: 100 requests per minute per IP, per the security spec.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL_SECONDS')! * 1000,
          limit: config.get<number>('THROTTLE_LIMIT')!,
        },
      ],
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
export class AppModule {}
