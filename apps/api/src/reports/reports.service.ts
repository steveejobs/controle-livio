import { Injectable } from '@nestjs/common';
import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ReportName, ReportRange } from './report.schemas';

type Row = Record<string, unknown>;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  receivablesDue(actor: AuthenticatedActor, range: ReportRange) {
    return this.groupedInstallments(actor.organizationId, range, 'due_date', 'vencimento');
  }

  accrual(actor: AuthenticatedActor, range: ReportRange) {
    return this.groupedInstallments(actor.organizationId, range, 'competence_date', 'competência');
  }

  async received(actor: AuthenticatedActor, range: ReportRange) {
    const unit = Prisma.raw(`'${range.groupBy}'`);
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT date_trunc(${unit}, paid_at)::date AS period,
             SUM(amount)::numeric(19,4) AS amount,
             COUNT(*)::int AS payments
      FROM payments
      WHERE organization_id = ${actor.organizationId}::uuid
        AND status = 'CONFIRMED'
        AND paid_at >= ${range.from} AND paid_at < ${range.to}
      GROUP BY 1 ORDER BY 1`);
    return { basis: 'recebimento/caixa', rows: this.normalize(rows) };
  }

  async overdue(actor: AuthenticatedActor) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      ${this.balancesCte(actor.organizationId)}
      SELECT b.installment_id, b.receivable_id, b.client_id, c.display_name AS client,
             b.due_date, b.balance::numeric(19,4) AS balance,
             (CURRENT_DATE - b.due_date)::int AS days_overdue
      FROM balances b JOIN clients c ON c.id = b.client_id
      WHERE b.due_date < CURRENT_DATE AND b.balance > 0
        AND b.status NOT IN ('CANCELLED', 'RENEGOTIATED')
      ORDER BY b.due_date`);
    return { basis: 'vencimento', rows: this.normalize(rows) };
  }

  async aging(actor: AuthenticatedActor) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      ${this.balancesCte(actor.organizationId)}
      SELECT CASE
          WHEN CURRENT_DATE - due_date <= 30 THEN '1-30'
          WHEN CURRENT_DATE - due_date <= 60 THEN '31-60'
          WHEN CURRENT_DATE - due_date <= 90 THEN '61-90'
          ELSE '90+'
        END AS bucket,
        SUM(balance)::numeric(19,4) AS balance,
        COUNT(*)::int AS installments
      FROM balances
      WHERE due_date < CURRENT_DATE AND balance > 0 AND status NOT IN ('CANCELLED', 'RENEGOTIATED')
      GROUP BY 1 ORDER BY MIN(CURRENT_DATE - due_date)`);
    return { basis: 'vencimento', rows: this.normalize(rows) };
  }

  async cashForecast(actor: AuthenticatedActor) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      ${this.balancesCte(actor.organizationId)}
      SELECT date_trunc('week', due_date)::date AS period,
             SUM(balance)::numeric(19,4) AS expected_amount,
             COUNT(*)::int AS installments
      FROM balances
      WHERE due_date >= CURRENT_DATE AND balance > 0 AND status NOT IN ('CANCELLED', 'RENEGOTIATED')
      GROUP BY 1 ORDER BY 1`);
    return { basis: 'previsão_por_vencimento', rows: this.normalize(rows) };
  }

  async partialPayments(actor: AuthenticatedActor) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      ${this.balancesCte(actor.organizationId)}
      SELECT installment_id, receivable_id, client_id, due_date,
             paid::numeric(19,4) AS paid_amount, balance::numeric(19,4) AS remaining_amount
      FROM balances WHERE paid > 0 AND balance > 0 AND status NOT IN ('CANCELLED', 'RENEGOTIATED')
      ORDER BY due_date`);
    return { basis: 'pagamentos_alocados', rows: this.normalize(rows) };
  }

  async activeContracts(actor: AuthenticatedActor) {
    const rows = await this.prisma.contract.findMany({
      where: { organizationId: actor.organizationId, status: 'ACTIVE' },
      select: {
        id: true,
        number: true,
        title: true,
        clientId: true,
        serviceCode: true,
        serviceName: true,
        fixedAmount: true,
        currency: true,
        startsAt: true,
        endsAt: true,
      },
      orderBy: { startsAt: 'desc' },
    });
    return { basis: 'estado_contratual', rows: this.normalize(rows as unknown as Row[]) };
  }

  async revenueByLawyer(actor: AuthenticatedActor) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT m.responsible_lawyer_id AS lawyer_id, u.full_name AS lawyer,
             SUM(pa.amount)::numeric(19,4) AS received_amount
      FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id AND p.status = 'CONFIRMED'
      JOIN receivable_installments i ON i.id = pa.installment_id
      JOIN receivables r ON r.id = i.receivable_id
      JOIN matters m ON m.id = r.matter_id
      LEFT JOIN users u ON u.id = m.responsible_lawyer_id
      WHERE pa.organization_id = ${actor.organizationId}::uuid AND pa.reversed_at IS NULL
      GROUP BY 1, 2 ORDER BY received_amount DESC`);
    return { basis: 'caixa_alocado', rows: this.normalize(rows) };
  }

  async revenueByService(actor: AuthenticatedActor) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT COALESCE(c.service_code, 'sem-codigo') AS service_code,
             COALESCE(c.service_name, 'Sem serviço') AS service,
             SUM(pa.amount)::numeric(19,4) AS received_amount
      FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id AND p.status = 'CONFIRMED'
      JOIN receivable_installments i ON i.id = pa.installment_id
      JOIN receivables r ON r.id = i.receivable_id
      LEFT JOIN contracts c ON c.id = r.contract_id
      WHERE pa.organization_id = ${actor.organizationId}::uuid AND pa.reversed_at IS NULL
      GROUP BY 1, 2 ORDER BY received_amount DESC`);
    return { basis: 'caixa_alocado', rows: this.normalize(rows) };
  }

  async delinquentClients(actor: AuthenticatedActor) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      ${this.balancesCte(actor.organizationId)}
      SELECT client_id, c.display_name AS client,
             SUM(balance)::numeric(19,4) AS overdue_balance,
             COUNT(*)::int AS overdue_installments,
             MIN(due_date) AS oldest_due_date
      FROM balances b JOIN clients c ON c.id = b.client_id
      WHERE due_date < CURRENT_DATE AND balance > 0 AND b.status NOT IN ('CANCELLED', 'RENEGOTIATED')
      GROUP BY client_id, c.display_name ORDER BY overdue_balance DESC`);
    return { basis: 'vencimento', rows: this.normalize(rows) };
  }

  async reconciliation(actor: AuthenticatedActor) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT p.id AS payment_id, p.reference, p.amount::numeric(19,4) AS payment_amount,
             COALESCE(SUM(pa.amount) FILTER (WHERE pa.reversed_at IS NULL), 0)::numeric(19,4) AS allocated_amount,
             (p.amount - COALESCE(SUM(pa.amount) FILTER (WHERE pa.reversed_at IS NULL), 0))::numeric(19,4) AS unapplied_amount,
             p.status
      FROM payments p LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
      WHERE p.organization_id = ${actor.organizationId}::uuid
      GROUP BY p.id ORDER BY p.paid_at DESC`);
    return { basis: 'conciliação_pagamento_alocação', rows: this.normalize(rows) };
  }

  async run(actor: AuthenticatedActor, report: ReportName, range?: ReportRange) {
    if (report === 'receivables-due' && range) return this.receivablesDue(actor, range);
    if (report === 'received' && range) return this.received(actor, range);
    if (report === 'accrual' && range) return this.accrual(actor, range);
    const runners = {
      overdue: () => this.overdue(actor),
      aging: () => this.aging(actor),
      'cash-forecast': () => this.cashForecast(actor),
      'partial-payments': () => this.partialPayments(actor),
      'active-contracts': () => this.activeContracts(actor),
      'revenue-by-lawyer': () => this.revenueByLawyer(actor),
      'revenue-by-service': () => this.revenueByService(actor),
      'delinquent-clients': () => this.delinquentClients(actor),
      reconciliation: () => this.reconciliation(actor),
    } as const;
    if (report in runners) return runners[report as keyof typeof runners]();
    throw new Error('Relatório exige período');
  }

  private async groupedInstallments(
    organizationId: string,
    range: ReportRange,
    column: 'due_date' | 'competence_date',
    basis: string,
  ) {
    const unit = Prisma.raw(`'${range.groupBy}'`);
    const dateColumn = Prisma.raw(column);
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      ${this.balancesCte(organizationId)}
      SELECT date_trunc(${unit}, ${dateColumn})::date AS period,
             SUM(balance)::numeric(19,4) AS amount,
             COUNT(*)::int AS installments
      FROM balances
      WHERE ${dateColumn} >= ${range.from}::date AND ${dateColumn} < ${range.to}::date
        AND status NOT IN ('CANCELLED', 'RENEGOTIATED')
      GROUP BY 1 ORDER BY 1`);
    return { basis, rows: this.normalize(rows) };
  }

  private balancesCte(organizationId: string) {
    return Prisma.sql`WITH adjustments AS (
      SELECT installment_id,
        SUM(CASE WHEN kind IN ('DISCOUNT','REVERSAL') THEN -amount ELSE amount END) AS delta
      FROM financial_adjustments
      WHERE organization_id = ${organizationId}::uuid AND approved_at IS NOT NULL
      GROUP BY installment_id
    ), paid AS (
      SELECT pa.installment_id, SUM(pa.amount) AS amount
      FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
      WHERE pa.organization_id = ${organizationId}::uuid AND pa.reversed_at IS NULL AND p.status = 'CONFIRMED'
      GROUP BY pa.installment_id
    ), balances AS (
      SELECT i.id AS installment_id, i.receivable_id, r.client_id, i.due_date,
        COALESCE(i.competence_date, r.competence_date, r.issue_date) AS competence_date,
        i.status, COALESCE(p.amount, 0) AS paid,
        (i.amount + COALESCE(a.delta, 0) - COALESCE(p.amount, 0)) AS balance
      FROM receivable_installments i
      JOIN receivables r ON r.id = i.receivable_id
      LEFT JOIN adjustments a ON a.installment_id = i.id
      LEFT JOIN paid p ON p.installment_id = i.id
      WHERE i.organization_id = ${organizationId}::uuid
    )`;
  }

  private normalize(rows: Row[]): Row[] {
    return rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          Prisma.Decimal.isDecimal(value) ? value.toFixed(2) : value,
        ]),
      ),
    );
  }
}
