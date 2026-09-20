import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@chicago-pizza/prisma';
import { AuditModule, baseEnvSchema, RedisModule, validateEnv } from '@chicago-pizza/common';
import { ProductsController } from './products.controller';
import { CatalogService } from './services/catalog.service';
import { PricingService } from './services/pricing.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (raw) => validateEnv(baseEnvSchema, raw) }),
    PrismaModule,
    RedisModule,
    AuditModule,
  ],
  controllers: [ProductsController],
  providers: [CatalogService, PricingService],
})
export class AppModule {}
