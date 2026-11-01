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
      , incoming AS (
        SELECT date_trunc('week', due_date)::date AS period, currency,
               SUM(balance)::numeric(19,4) AS expected_amount,
               COUNT(*)::int AS installments
          FROM balances
         WHERE due_date >= CURRENT_DATE AND balance > 0
           AND status NOT IN ('CANCELLED', 'RENEGOTIATED')
         GROUP BY 1, 2
      ), outgoing AS (
        SELECT date_trunc('week', due_date)::date AS period, currency,
               SUM(amount)::numeric(19,4) AS expected_expenses,
               COUNT(*)::int AS expenses_due
          FROM expenses
         WHERE organization_id = ${actor.organizationId}::uuid
           AND status = 'APPROVED' AND due_date >= CURRENT_DATE
         GROUP BY 1, 2
      )
      SELECT COALESCE(i.period, o.period) AS period, COALESCE(i.currency, o.currency) AS currency,
             COALESCE(i.expected_amount, 0)::numeric(19,4) AS expected_amount,
             COALESCE(i.installments, 0)::int AS installments,
             COALESCE(o.expected_expenses, 0)::numeric(19,4) AS expected_expenses,
             COALESCE(o.expenses_due, 0)::int AS expenses_due,
             (COALESCE(i.expected_amount, 0) - COALESCE(o.expected_expenses, 0))::numeric(19,4) AS projected_net
        FROM incoming i FULL JOIN outgoing o USING (period, currency)
       ORDER BY period, currency`);
    return { basis: 'previsão_por_vencimento', rows: this.normalizeExact(rows) };
  }

  async cashFlow(actor: AuthenticatedActor, range: ReportRange) {
    const unit = Prisma.raw(`'${range.groupBy}'`);
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      ${this.balancesCte(actor.organizationId)}, incoming AS (
        SELECT date_trunc(${unit}, due_date)::date AS period, currency,
               SUM(balance)::numeric(19,4) AS expected_receivables,
               COUNT(*)::int AS open_installments
          FROM balances
         WHERE due_date >= ${range.from}::date AND due_date < ${range.to}::date
           AND balance > 0 AND status NOT IN ('CANCELLED', 'RENEGOTIATED')
         GROUP BY 1, 2
      ), received AS (
        SELECT date_trunc(${unit}, paid_at)::date AS period, currency,
               SUM(amount)::numeric(19,4) AS received_amount,
               COUNT(*)::int AS confirmed_payments
          FROM payments
         WHERE organization_id = ${actor.organizationId}::uuid
           AND status = 'CONFIRMED'
           AND paid_at >= ${range.from} AND paid_at < ${range.to}
         GROUP BY 1, 2
      ), planned_expenses AS (
        SELECT date_trunc(${unit}, due_date)::date AS period, currency,
               SUM(amount) FILTER (WHERE status = 'APPROVED')::numeric(19,4) AS expected_expenses,
               SUM(amount) FILTER (WHERE status = 'PENDING_APPROVAL')::numeric(19,4) AS pending_approval_expenses,
               COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved_expenses
          FROM expenses
         WHERE organization_id = ${actor.organizationId}::uuid
           AND status IN ('APPROVED', 'PENDING_APPROVAL')
           AND due_date >= ${range.from}::date AND due_date < ${range.to}::date
         GROUP BY 1, 2
      ), paid_expenses AS (
        SELECT date_trunc(${unit}, paid_at)::date AS period, currency,
               SUM(amount)::numeric(19,4) AS paid_expenses,
               COUNT(*)::int AS paid_expense_count
          FROM expenses
         WHERE organization_id = ${actor.organizationId}::uuid AND status = 'PAID'
           AND paid_at >= ${range.from}::date AND paid_at < ${range.to}::date
         GROUP BY 1, 2
      ), periods AS (
        SELECT period, currency FROM incoming UNION SELECT period, currency FROM received
        UNION SELECT period, currency FROM planned_expenses UNION SELECT period, currency FROM paid_expenses
      )
      SELECT p.period, p.currency,
             COALESCE(r.received_amount, 0)::numeric(19,4) AS received_amount,
             COALESCE(pe.paid_expenses, 0)::numeric(19,4) AS paid_expenses,
             (COALESCE(r.received_amount, 0) - COALESCE(pe.paid_expenses, 0))::numeric(19,4) AS net_cash,
             COALESCE(i.expected_receivables, 0)::numeric(19,4) AS expected_receivables,
             COALESCE(pl.expected_expenses, 0)::numeric(19,4) AS expected_expenses,
             (COALESCE(i.expected_receivables, 0) - COALESCE(pl.expected_expenses, 0))::numeric(19,4) AS projected_net,
             COALESCE(pl.pending_approval_expenses, 0)::numeric(19,4) AS pending_approval_expenses,
             COALESCE(i.open_installments, 0)::int AS open_installments,
             COALESCE(r.confirmed_payments, 0)::int AS confirmed_payments,
             COALESCE(pl.approved_expenses, 0)::int AS approved_expenses,
             COALESCE(pe.paid_expense_count, 0)::int AS paid_expense_count
        FROM periods p
        LEFT JOIN incoming i USING (period, currency)
        LEFT JOIN received r USING (period, currency)
        LEFT JOIN planned_expenses pl USING (period, currency)
        LEFT JOIN paid_expenses pe USING (period, currency)
       ORDER BY p.period, p.currency`);
    return { basis: 'caixa_real_e_previsão_por_vencimento', rows: this.normalizeExact(rows) };
  }

  async cashFlowByClient(actor: AuthenticatedActor, range: ReportRange) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH received AS (
        SELECT r.client_id, r.matter_id, p.currency,
               SUM(pa.amount)::numeric(19,4) AS received_amount
          FROM payment_allocations pa
          JOIN payments p ON p.id = pa.payment_id
            AND p.organization_id = ${actor.organizationId}::uuid
            AND p.status = 'CONFIRMED'
          JOIN receivable_installments i ON i.id = pa.installment_id
          JOIN receivables r ON r.id = i.receivable_id
            AND r.organization_id = ${actor.organizationId}::uuid
         WHERE pa.organization_id = ${actor.organizationId}::uuid
           AND pa.reversed_at IS NULL
           AND p.paid_at >= ${range.from} AND p.paid_at < ${range.to}
         GROUP BY r.client_id, r.matter_id, p.currency
      ), paid_expenses AS (
        SELECT client_id, matter_id, currency, SUM(amount)::numeric(19,4) AS paid_expenses
          FROM expenses
         WHERE organization_id = ${actor.organizationId}::uuid
           AND status = 'PAID' AND paid_at >= ${range.from}::date AND paid_at < ${range.to}::date
         GROUP BY client_id, matter_id, currency
      ), dimensions AS (
        SELECT client_id, matter_id, currency FROM received
        UNION SELECT client_id, matter_id, currency FROM paid_expenses
      )
      SELECT d.client_id, c.display_name AS client, d.currency,
             d.matter_id, m.reference AS matter,
             COALESCE(r.received_amount, 0)::numeric(19,4) AS received_amount,
             COALESCE(e.paid_expenses, 0)::numeric(19,4) AS paid_expenses,
             (COALESCE(r.received_amount, 0) - COALESCE(e.paid_expenses, 0))::numeric(19,4) AS net_cash
        FROM dimensions d
        LEFT JOIN clients c ON c.id = d.client_id AND c.organization_id = ${actor.organizationId}::uuid
        LEFT JOIN matters m ON m.id = d.matter_id AND m.organization_id = ${actor.organizationId}::uuid
        LEFT JOIN received r ON r.client_id IS NOT DISTINCT FROM d.client_id
          AND r.matter_id IS NOT DISTINCT FROM d.matter_id AND r.currency = d.currency
        LEFT JOIN paid_expenses e ON e.client_id IS NOT DISTINCT FROM d.client_id
          AND e.matter_id IS NOT DISTINCT FROM d.matter_id AND e.currency = d.currency
       ORDER BY c.display_name, m.reference, d.currency`);
    return { basis: 'caixa_por_cliente_e_processo', rows: this.normalizeExact(rows) };
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
      'cash-flow': () =>
        range ? this.cashFlow(actor, range) : Promise.reject(new Error('Relatório exige período')),
      'cash-flow-by-client': () =>
        range
          ? this.cashFlowByClient(actor, range)
          : Promise.reject(new Error('Relatório exige período')),
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
      SELECT i.id AS installment_id, i.receivable_id, r.client_id, i.currency, i.due_date,
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

  private normalizeExact(rows: Row[]): Row[] {
    return rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          Prisma.Decimal.isDecimal(value) ? value.toFixed(4) : value,
        ]),
      ),
    );
  }
}
