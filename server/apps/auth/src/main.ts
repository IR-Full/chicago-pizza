import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  RmqAckInterceptor,
  RpcExceptionFilter,
  RMQ_QUEUES,
  startHealthEndpoint,
} from '@chicago-pizza/common';
import { rabbitmqMicroserviceOptions } from '@chicago-pizza/rabbitmq';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(
    AppModule,
    rabbitmqMicroserviceOptions(process.env.RABBITMQ_URL!, RMQ_QUEUES.AUTH),
  );

  // `whitelist` strips anything the DTO does not declare; `forbidNonWhitelisted`
  // would additionally *reject* it, and that broke every auth call that binds
  // a DTO class. `rpcSend` adds `x-request-id` to the payload so the trail
  // survives the hop through RabbitMQ — a key we put there on purpose, which
  // this service was answering with "property x-request-id should not exist".
  // Registration was dead; login only survived because its handler binds an
  // intersection type, which Nest cannot validate at all.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new RpcExceptionFilter());
  app.useGlobalInterceptors(new RmqAckInterceptor());

  // Without this Nest never runs onModuleDestroy on SIGTERM: Prisma pools and
  // the RabbitMQ channel were torn down by the kill, mid-message.
  app.enableShutdownHooks();

  startHealthEndpoint(Number(process.env.PORT ?? 3001), 'auth');

  await app.listen();
  Logger.log(`Auth microservice listening on queue "${RMQ_QUEUES.AUTH}"`, 'Bootstrap');
}

bootstrap().catch((error) => {
  // An unhandled rejection here prints a bare stack trace and leaves the
  // container restarting with no indication of what failed to start.
  Logger.error('Failed to start', error instanceof Error ? error.stack : String(error), 'Bootstrap');
  process.exit(1);
});
