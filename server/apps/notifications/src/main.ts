import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RpcExceptionFilter, RMQ_QUEUES } from '@chicago-pizza/common';
import { rabbitmqMicroserviceOptions } from '@chicago-pizza/rabbitmq';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(
    AppModule,
    rabbitmqMicroserviceOptions(process.env.RABBITMQ_URL!, RMQ_QUEUES.NOTIFICATIONS),
  );

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new RpcExceptionFilter());

  await app.listen();
  Logger.log(`NOTIFICATIONS microservice listening on queue "${RMQ_QUEUES.NOTIFICATIONS}"`, 'Bootstrap');
}

bootstrap();
