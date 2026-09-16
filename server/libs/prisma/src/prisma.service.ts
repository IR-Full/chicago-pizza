import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    // @ts-expect-error - Prisma event typing narrows by log config, but the constructor above guarantees these events exist.
    this.$on('warn', (e) => this.logger.warn(e.message));
    // @ts-expect-error - see above
    this.$on('error', (e) => this.logger.error(e.message));
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
