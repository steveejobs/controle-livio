import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StorageService } from '../documents/storage.service';
import { StorageRecoveryService } from './storage-recovery.service';
import { StorageRecoveryAdminService } from './storage-recovery-admin.service';

@Module({
  imports: [AuditModule],
  providers: [StorageService, StorageRecoveryService, StorageRecoveryAdminService],
  exports: [StorageService, StorageRecoveryService, StorageRecoveryAdminService],
})
export class StorageRecoveryModule {}
