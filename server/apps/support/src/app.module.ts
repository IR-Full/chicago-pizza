import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@chicago-pizza/prisma';
import { baseEnvSchema, RMQ_QUEUES, validateEnv } from '@chicago-pizza/common';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { SupportController } from './support.controller';
import { SupportService } from './services/support.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (raw) => validateEnv(baseEnvSchema, raw) }),
    PrismaModule,
    RabbitmqClientModule.register([{ name: 'NOTIFICATIONS_SERVICE', queue: RMQ_QUEUES.NOTIFICATIONS }]),
  ],
  controllers: [SupportController],
  providers: [SupportService],
})
export class AppModule {}
