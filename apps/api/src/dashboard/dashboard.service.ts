import { Injectable } from '@nestjs/common';
import { Prisma } from '@livio/db';
import { OrganizationScope } from '../auth/organization-scope';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardSummary {
  activeClients: number;
  activeMatters: number;
  overdueReceivables: number;
  openTasks: number;
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

  async summary(): Promise<DashboardSummary> {
    const tenant = this.scope.where();
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
          WITH months AS (
            SELECT generate_series(
              date_trunc('month', CURRENT_DATE),
              date_trunc('month', CURRENT_DATE) + INTERVAL '5 months',
              INTERVAL '1 month'
            )::date AS month
          ), paid AS (
            SELECT pa.installment_id, SUM(pa.amount) AS amount
            FROM payment_allocations pa
            JOIN payments p ON p.id = pa.payment_id AND p.status = 'CONFIRMED'
            WHERE pa.organization_id = ${tenant.organizationId}::uuid AND pa.reversed_at IS NULL
            GROUP BY pa.installment_id
          ), adjustments AS (
            SELECT installment_id,
              SUM(CASE WHEN kind IN ('DISCOUNT', 'REVERSAL') THEN -amount ELSE amount END) AS amount
            FROM financial_adjustments
            WHERE organization_id = ${tenant.organizationId}::uuid AND approved_at IS NOT NULL
            GROUP BY installment_id
          ), totals AS (
            SELECT date_trunc('month', i.due_date)::date AS month,
              SUM(i.amount + COALESCE(a.amount, 0)) AS due_amount,
              SUM(LEAST(COALESCE(p.amount, 0), i.amount + COALESCE(a.amount, 0))) AS received_amount,
              SUM(GREATEST(i.amount + COALESCE(a.amount, 0) - COALESCE(p.amount, 0), 0)) AS outstanding_amount,
              COUNT(*)::int AS installments
            FROM receivable_installments i
            LEFT JOIN paid p ON p.installment_id = i.id
            LEFT JOIN adjustments a ON a.installment_id = i.id
            WHERE i.organization_id = ${tenant.organizationId}::uuid
              AND i.status NOT IN ('CANCELLED', 'RENEGOTIATED')
              AND i.due_date >= date_trunc('month', CURRENT_DATE)
              AND i.due_date < date_trunc('month', CURRENT_DATE) + INTERVAL '6 months'
            GROUP BY 1
          )
          SELECT m.month,
            COALESCE(t.due_amount, 0)::numeric(19,4) AS due_amount,
            COALESCE(t.received_amount, 0)::numeric(19,4) AS received_amount,
            COALESCE(t.outstanding_amount, 0)::numeric(19,4) AS outstanding_amount,
            COALESCE(t.installments, 0)::int AS installments
          FROM months m LEFT JOIN totals t USING (month)
          ORDER BY m.month`),
      ]);
    return {
      activeClients,
      activeMatters,
      overdueReceivables,
      openTasks,
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
