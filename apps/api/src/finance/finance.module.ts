import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { ServiceCatalogService } from './service-catalog.service';
import { DocumentsModule } from '../documents/documents.module';
import { ReceiptController } from './receipt.controller';
import { ReceiptService } from './receipt.service';
import { ReceiptExtractionService } from './receipt-extraction.service';

@Module({
  imports: [AuthModule, AuditModule, NotificationsModule, DocumentsModule],
  controllers: [FinanceController, ReceiptController],
  providers: [FinanceService, ServiceCatalogService, ReceiptService, ReceiptExtractionService],
  exports: [FinanceService, ServiceCatalogService],
})
export class FinanceModule {}
