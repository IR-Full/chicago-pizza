import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@chicago-pizza/prisma';
import { AuditModule, baseEnvSchema, RedisModule, RMQ_QUEUES, validateEnv } from '@chicago-pizza/common';
import { RabbitmqClientModule } from '@chicago-pizza/rabbitmq';
import { ProductsController } from './products.controller';
import { CatalogService } from './services/catalog.service';
import { PricingService } from './services/pricing.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (raw) => validateEnv(baseEnvSchema, raw) }),
    PrismaModule,
    RedisModule,
    AuditModule,
    // Recommendations need the customer's order history, which belongs to the
    // orders domain. Orders calls products for pricing, so the two modules
    // reference each other — but never within one request, so there is no
    // cycle to deadlock on.
    RabbitmqClientModule.register([{ name: 'ORDERS_SERVICE', queue: RMQ_QUEUES.ORDERS }]),
  ],
  controllers: [ProductsController],
  providers: [CatalogService, PricingService],
})
export class AppModule {}
