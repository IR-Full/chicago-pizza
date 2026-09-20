import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RpcExceptionFilter, RMQ_QUEUES, startHealthEndpoint } from '@chicago-pizza/common';
import { rabbitmqMicroserviceOptions } from '@chicago-pizza/rabbitmq';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(
    AppModule,
    rabbitmqMicroserviceOptions(process.env.RABBITMQ_URL!, RMQ_QUEUES.ORDERS),
  );

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new RpcExceptionFilter());

  // Without this Nest never runs onModuleDestroy on SIGTERM: Prisma pools and
  // the RabbitMQ channel were torn down by the kill, mid-message.
  app.enableShutdownHooks();

  startHealthEndpoint(Number(process.env.PORT ?? 3003), 'orders');

  await app.listen();
  Logger.log(`ORDERS microservice listening on queue "${RMQ_QUEUES.ORDERS}"`, 'Bootstrap');
}

bootstrap().catch((error) => {
  // An unhandled rejection here prints a bare stack trace and leaves the
  // container restarting with no indication of what failed to start.
  Logger.error('Failed to start', error instanceof Error ? error.stack : String(error), 'Bootstrap');
  process.exit(1);
});
