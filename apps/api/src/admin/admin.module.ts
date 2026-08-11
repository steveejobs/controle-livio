import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService, SupabaseAdminService],
})
export class AdminModule {}
