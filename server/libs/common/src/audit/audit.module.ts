import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '@chicago-pizza/prisma';
import { AuditService } from './audit.service';

/**
 * Global so any service can record a privileged action without each module
 * re-importing it — the trail is only useful if writing to it is never the
 * inconvenient option.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
