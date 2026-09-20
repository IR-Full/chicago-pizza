import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter, LoggingInterceptor } from '@chicago-pizza/common';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT ?? 4000);
  const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:3000';

  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });

  // Behind Nginx: needed for req.ip and secure-cookie detection to be correct.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", clientUrl, 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({
    origin: clientUrl,
    // Required for the httpOnly auth cookies to be sent cross-origin in dev.
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Unknown properties are stripped rather than rejected. Rejecting them
      // also applied to the query string, so a perfectly ordinary marketing
      // link (`/api/products?utm_source=vk`) answered 400; stripping keeps the
      // same guarantee for the services, which never see the extra fields.
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const redisAdapter = new RedisIoAdapter(app, process.env.REDIS_URL!);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  // Swagger mounts its route outside the Nest guards, so in production it
  // would publish the whole API surface — including every DTO — to anyone.
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Chicago Pizza API')
      .setDescription('Публичный API сети пиццерий «Chicago Pizza» (Махачкала)')
      .setVersion('1.0')
      .addCookieAuth('access_token')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }

  // Lets Nest close Prisma, Redis and the socket server on SIGTERM instead of
  // having them killed mid-request during a deploy.
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  Logger.log(`Gateway listening on http://localhost:${port} (docs at /api/docs)`, 'Bootstrap');
}

bootstrap().catch((error) => {
  // An unhandled rejection here prints a bare stack trace and leaves the
  // container restarting with no indication of what failed to start.
  Logger.error('Failed to start', error instanceof Error ? error.stack : String(error), 'Bootstrap');
  process.exit(1);
});
