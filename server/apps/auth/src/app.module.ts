import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '@chicago-pizza/prisma';
import { RedisModule, RMQ_QUEUES } from '@chicago-pizza/common';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { loadAuthEnv } from './config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { AddressService } from './services/address.service';
import { TokenService } from './services/token.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadAuthEnv }),
    PrismaModule,
    RedisModule,
    JwtModule.register({}),
    RabbitmqClientModule.register([{ name: 'NOTIFICATIONS_SERVICE', queue: RMQ_QUEUES.NOTIFICATIONS }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, AddressService, TokenService],
})
export class AppModule {}
