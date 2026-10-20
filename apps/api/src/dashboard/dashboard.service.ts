import { Injectable } from '@nestjs/common';
import { Prisma } from '@livio/db';
import { OrganizationScope } from '../auth/organization-scope';
import { PrismaService } from '../prisma/prisma.service';
import type { DashboardPeriod } from './dashboard.schemas';

export interface DashboardSummary {
  activeClients: number;
  activeMatters: number;
  overdueReceivables: number;
  openTasks: number;
  period: DashboardPeriod;
  bucket: 'month' | 'year';
  monthlyReceivables: Array<{
    month: string;
    dueAmount: string;
    receivedAmount: string;
    outstandingAmount: string;
    installments: number;
  }>;
  generatedAt: string;
}

type MonthlyRow = {
  month: Date;
  due_amount: Prisma.Decimal;
  received_amount: Prisma.Decimal;
  outstanding_amount: Prisma.Decimal;
  installments: number;
};

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrganizationScope,
  ) {}

  async summary(period: DashboardPeriod = '6m'): Promise<DashboardSummary> {
    const tenant = this.scope.where();
    const allPeriod = period === 'all';
    const months = period === '3m' ? 3 : period === '12m' ? 12 : 6;
    const bucket = allPeriod ? 'year' : 'month';
    const dueDateFilter = allPeriod
      ? Prisma.empty
      : Prisma.sql`AND i.due_date >= date_trunc('month', CURRENT_DATE)
          AND i.due_date < date_trunc('month', CURRENT_DATE) + ${months} * INTERVAL '1 month'`;
    const [activeClients, activeMatters, overdueReceivables, openTasks, monthlyReceivables] =
      await this.prisma.$transaction([
        this.prisma.client.count({ where: { ...tenant, deletedAt: null } }),
        this.prisma.matter.count({ where: { ...tenant, deletedAt: null, status: 'ACTIVE' } }),
        this.prisma.receivable.count({
          where: {
            ...tenant,
            status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
            dueDate: { lt: new Date() },
          },
        }),
        this.prisma.task.count({
          where: { ...tenant, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } },
        }),
        this.prisma.$queryRaw<MonthlyRow[]>(Prisma.sql`
          WITH installments_in_period AS (
            SELECT i.id, i.organization_id, i.due_date, i.amount
            FROM receivable_installments i
            WHERE i.organization_id = ${tenant.organizationId}::uuid
              AND i.status NOT IN ('CANCELLED', 'RENEGOTIATED')
              ${dueDateFilter}
          ), bounds AS (
            SELECT
              CASE WHEN ${allPeriod}
                THEN COALESCE(date_trunc('year', MIN(due_date)), date_trunc('year', CURRENT_DATE))
                ELSE date_trunc('month', CURRENT_DATE)
              END AS first_bucket,
              CASE WHEN ${allPeriod}
                THEN GREATEST(
                  COALESCE(date_trunc('year', MAX(due_date)), date_trunc('year', CURRENT_DATE)),
                  date_trunc('year', CURRENT_DATE)
                )
                ELSE date_trunc('month', CURRENT_DATE) + ${months - 1} * INTERVAL '1 month'
              END AS last_bucket
            FROM installments_in_period
          ), buckets AS (
            SELECT generate_series(
              first_bucket,
              last_bucket,
              CASE WHEN ${allPeriod} THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END
            )::date AS month
            FROM bounds
          ), paid AS (
            SELECT pa.installment_id, SUM(pa.amount) AS amount
            FROM payment_allocations pa
            JOIN payments p ON p.id = pa.payment_id AND p.status = 'CONFIRMED'
            JOIN installments_in_period ip ON ip.id = pa.installment_id
            WHERE pa.organization_id = ${tenant.organizationId}::uuid AND pa.reversed_at IS NULL
            GROUP BY pa.installment_id
          ), adjustments AS (
            SELECT fa.installment_id,
              SUM(CASE WHEN fa.kind IN ('DISCOUNT', 'REVERSAL') THEN -fa.amount ELSE fa.amount END) AS amount
            FROM financial_adjustments fa
            JOIN installments_in_period ip ON ip.id = fa.installment_id
            WHERE fa.organization_id = ${tenant.organizationId}::uuid AND fa.approved_at IS NOT NULL
            GROUP BY installment_id
          ), totals AS (
            SELECT CASE WHEN ${allPeriod}
                THEN date_trunc('year', i.due_date)::date
                ELSE date_trunc('month', i.due_date)::date
              END AS month,
              SUM(i.amount + COALESCE(a.amount, 0)) AS due_amount,
              SUM(LEAST(COALESCE(p.amount, 0), i.amount + COALESCE(a.amount, 0))) AS received_amount,
              SUM(GREATEST(i.amount + COALESCE(a.amount, 0) - COALESCE(p.amount, 0), 0)) AS outstanding_amount,
              COUNT(*)::int AS installments
            FROM installments_in_period i
            LEFT JOIN paid p ON p.installment_id = i.id
            LEFT JOIN adjustments a ON a.installment_id = i.id
            GROUP BY 1
          )
          SELECT m.month,
            COALESCE(t.due_amount, 0)::numeric(19,4) AS due_amount,
            COALESCE(t.received_amount, 0)::numeric(19,4) AS received_amount,
            COALESCE(t.outstanding_amount, 0)::numeric(19,4) AS outstanding_amount,
            COALESCE(t.installments, 0)::int AS installments
          FROM buckets m LEFT JOIN totals t USING (month)
          ORDER BY m.month`),
      ]);
    return {
      activeClients,
      activeMatters,
      overdueReceivables,
      openTasks,
      period,
      bucket,
      monthlyReceivables: monthlyReceivables.map((row) => ({
        month: row.month.toISOString().slice(0, 10),
        dueAmount: row.due_amount.toFixed(2),
        receivedAmount: row.received_amount.toFixed(2),
        outstandingAmount: row.outstanding_amount.toFixed(2),
        installments: row.installments,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
