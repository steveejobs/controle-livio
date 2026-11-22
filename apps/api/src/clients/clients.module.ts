import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [AuthModule, AuditModule, DocumentsModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
