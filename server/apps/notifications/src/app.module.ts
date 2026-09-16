import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@chicago-pizza/prisma';
import { loadNotificationsEnv } from './config/env';
import { NotificationsController } from './notifications.controller';
import { NotificationService, EMAIL_QUEUE } from './services/notification.service';
import { MailerService } from './services/mailer.service';
import { EmailProcessor } from './processors/email.processor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadNotificationsEnv }),
    PrismaModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get<string>('REDIS_URL')!);
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationService, MailerService, EmailProcessor],
})
export class AppModule {}
