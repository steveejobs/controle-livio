import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WorkController } from './work.controller';
import { WorkService } from './work.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [WorkController],
  providers: [WorkService],
})
export class WorkModule {}
