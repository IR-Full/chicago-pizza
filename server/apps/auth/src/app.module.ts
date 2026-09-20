import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@chicago-pizza/prisma';
import { AuditModule, RedisModule, RMQ_QUEUES } from '@chicago-pizza/common';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { loadAuthEnv } from './config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { AddressService } from './services/address.service';
import { TokenService } from './services/token.service';
import { TokenCleanupService } from './services/token-cleanup.service';
import { PrivacyService } from './services/privacy.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadAuthEnv }),
    PrismaModule,
    RedisModule,
    AuditModule,
    JwtModule.register({}),
    ScheduleModule.forRoot(),
    // Export and erasure reach across domains: each service owns the part of
    // a person's data that lives in its tables.
    RabbitmqClientModule.register([
      { name: 'NOTIFICATIONS_SERVICE', queue: RMQ_QUEUES.NOTIFICATIONS },
      { name: 'ORDERS_SERVICE', queue: RMQ_QUEUES.ORDERS },
      { name: 'SUPPORT_SERVICE', queue: RMQ_QUEUES.SUPPORT },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, AddressService, TokenService, TokenCleanupService, PrivacyService],
})
export class AppModule {}
