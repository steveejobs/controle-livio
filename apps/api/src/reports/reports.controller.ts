import type { Response } from 'express';
import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedActor } from '@livio/shared';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CsvExportService } from './csv-export.service';
import {
  reportNameSchema,
  reportRangeSchema,
  type ReportName,
  type ReportRange,
} from './report.schemas';
import { ReportsService } from './reports.service';

const exportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
});

@ApiTags('Relatórios')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly csv: CsvExportService,
  ) {}

  @Get('receivables-due')
  @RequirePermission('reports:view')
  receivablesDue(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRange,
  ) {
    return this.reports.receivablesDue(actor, range);
  }
  @Get('received')
  @RequirePermission('reports:view')
  received(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRange,
  ) {
    return this.reports.received(actor, range);
  }
  @Get('accrual')
  @RequirePermission('reports:view')
  accrual(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRange,
  ) {
    return this.reports.accrual(actor, range);
  }
  @Get('overdue') @RequirePermission('reports:view') overdue(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.reports.overdue(actor);
  }
  @Get('aging') @RequirePermission('reports:view') aging(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.reports.aging(actor);
  }
  @Get('cash-forecast') @RequirePermission('reports:view') forecast(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.reports.cashForecast(actor);
  }
  @Get('partial-payments') @RequirePermission('reports:view') partial(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.reports.partialPayments(actor);
  }
  @Get('active-contracts') @RequirePermission('reports:view') contracts(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.reports.activeContracts(actor);
  }
  @Get('revenue-by-lawyer') @RequirePermission('reports:view') byLawyer(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.reports.revenueByLawyer(actor);
  }
  @Get('revenue-by-service') @RequirePermission('reports:view') byService(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.reports.revenueByService(actor);
  }
  @Get('delinquent-clients') @RequirePermission('reports:view') delinquent(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.reports.delinquentClients(actor);
  }
  @Get('reconciliation') @RequirePermission('reports:view') reconciliation(
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.reports.reconciliation(actor);
  }

  @Get(':report/export.csv')
  @ApiProduces('text/csv')
  @RequirePermission('reports:export')
  async exportCsv(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('report', new ZodValidationPipe(reportNameSchema)) report: ReportName,
    @Query(new ZodValidationPipe(exportQuerySchema))
    query: { from?: Date; to?: Date; groupBy: 'day' | 'week' | 'month' },
    @Res() response: Response,
  ) {
    const range =
      query.from && query.to
        ? { from: query.from, to: query.to, groupBy: query.groupBy }
        : undefined;
    if (['receivables-due', 'received', 'accrual'].includes(report) && !range)
      throw new BadRequestException('Relatório exige from e to');
    const result = await this.reports.run(actor, report, range);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${report}.csv"`);
    response.send(this.csv.exportCsv(result.rows));
  }
}
