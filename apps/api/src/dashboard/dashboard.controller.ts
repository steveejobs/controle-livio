import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from '../auth/require-permission.decorator';
import { DashboardService, type DashboardSummary } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermission('reports:view')
  summary(): Promise<DashboardSummary> {
    return this.dashboard.summary();
  }
}
