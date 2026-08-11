import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MattersController } from './matters.controller';
import { MattersService } from './matters.service';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [MattersController, PipelinesController],
  providers: [MattersService, PipelinesService],
})
export class MattersModule {}
