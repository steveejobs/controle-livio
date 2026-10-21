import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { ServiceCatalogService } from './service-catalog.service';

@Module({
  imports: [AuthModule, AuditModule, NotificationsModule],
  controllers: [FinanceController],
  providers: [FinanceService, ServiceCatalogService],
  exports: [FinanceService, ServiceCatalogService],
})
export class FinanceModule {}
