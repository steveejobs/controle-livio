import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { StorageService } from '../documents/storage.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ClientsController],
  providers: [ClientsService, StorageService],
})
export class ClientsModule {}
