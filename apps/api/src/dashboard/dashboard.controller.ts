import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { dashboardSummaryQuerySchema, type DashboardPeriod } from './dashboard.schemas';
import { DashboardService, type DashboardSummary } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermission('reports:view')
  summary(
    @Query(new ZodValidationPipe(dashboardSummaryQuerySchema)) query: { period: DashboardPeriod },
  ): Promise<DashboardSummary> {
    return this.dashboard.summary(query.period);
  }
}
