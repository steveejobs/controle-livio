import { Module } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AuditController } from './audit.controller';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
