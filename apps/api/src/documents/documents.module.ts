import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsController } from './documents.controller';
import { DocumentSigningController } from './document-signing.controller';
import { DocumentSigningService } from './document-signing.service';
import { DocumentsService } from './documents.service';
import { DocumentGeneratorService } from './document-generator.service';
import { DocumentSettingsService } from './document-settings.service';
import { StorageService } from './storage.service';
import { DocumentUploadAdmissionInterceptor } from './document-upload-guards';
import { DocumentScannerService } from './document-scanner.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [DocumentsController, DocumentSigningController],
  providers: [
    DocumentsService,
    DocumentGeneratorService,
    DocumentSettingsService,
    DocumentSigningService,
    StorageService,
    DocumentUploadAdmissionInterceptor,
    DocumentScannerService,
  ],
})
export class DocumentsModule {}
