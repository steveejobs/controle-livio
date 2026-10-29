import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { describe, expect, it, vi } from 'vitest';
import { ReportsService } from './reports.service';

const actor: AuthenticatedActor = {
  userId: 'user-a',
  organizationId: 'org-a',
  permissions: ['reports:view'],
};

describe('ReportsService fluxo de caixa', () => {
  it('separa recebimentos confirmados, despesas pagas e previsões sem arredondar Decimal', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        period: new Date('2026-10-01T00:00:00.000Z'),
        currency: 'BRL',
        received_amount: new Prisma.Decimal('100.1234'),
        paid_expenses: new Prisma.Decimal('22.1111'),
        net_cash: new Prisma.Decimal('78.0123'),
        expected_receivables: new Prisma.Decimal('50.0001'),
        expected_expenses: new Prisma.Decimal('10.0001'),
        projected_net: new Prisma.Decimal('40.0000'),
        pending_approval_expenses: new Prisma.Decimal('5.5000'),
        open_installments: 2,
        confirmed_payments: 1,
        approved_expenses: 1,
        paid_expense_count: 1,
      },
      {
        period: new Date('2026-10-01T00:00:00.000Z'),
        currency: 'USD',
        received_amount: new Prisma.Decimal('12.0001'),
        paid_expenses: new Prisma.Decimal('4.0000'),
        net_cash: new Prisma.Decimal('8.0001'),
        expected_receivables: new Prisma.Decimal('0.0000'),
        expected_expenses: new Prisma.Decimal('0.0000'),
        projected_net: new Prisma.Decimal('0.0000'),
        pending_approval_expenses: new Prisma.Decimal('0.0000'),
        open_installments: 0,
        confirmed_payments: 1,
        approved_expenses: 0,
        paid_expense_count: 1,
      },
    ]);
    const service = new ReportsService({ $queryRaw: queryRaw } as never);

    const result = await service.cashFlow(actor, {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-11-01T00:00:00.000Z'),
      groupBy: 'month',
    });

    expect(result.basis).toBe('caixa_real_e_previsão_por_vencimento');
    expect(result.rows[0]).toMatchObject({
      currency: 'BRL',
      received_amount: '100.1234',
      paid_expenses: '22.1111',
      net_cash: '78.0123',
      expected_receivables: '50.0001',
      expected_expenses: '10.0001',
      projected_net: '40.0000',
      pending_approval_expenses: '5.5000',
    });
    expect(result.rows[1]).toMatchObject({ currency: 'USD', received_amount: '12.0001' });
    expect(queryRaw.mock.calls[0]?.[0].sql).toContain('GROUP BY 1, 2');
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('mantém recebimentos como caixa efetivo e inclui somente pagamentos confirmados', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        period: new Date('2026-10-01T00:00:00.000Z'),
        amount: new Prisma.Decimal('45.6789'),
        payments: 1,
      },
    ]);
    const service = new ReportsService({ $queryRaw: queryRaw } as never);

    await expect(
      service.received(actor, {
        from: new Date('2026-10-01T00:00:00.000Z'),
        to: new Date('2026-11-01T00:00:00.000Z'),
        groupBy: 'month',
      }),
    ).resolves.toMatchObject({ basis: 'recebimento/caixa', rows: [{ amount: '45.68' }] });
    const query = queryRaw.mock.calls[0]?.[0];
    expect(query?.sql).toContain("status = 'CONFIRMED'");
    expect(query?.sql).toContain('payments');
  });

  it('calcula caixa real por cliente/processo apenas com alocações e despesas pagas do tenant', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        client_id: 'client-a',
        client: 'Cliente QA sintético',
        currency: 'BRL',
        matter_id: 'matter-a',
        matter: 'QA-001',
        received_amount: new Prisma.Decimal('75.5555'),
        paid_expenses: new Prisma.Decimal('12.1111'),
        net_cash: new Prisma.Decimal('63.4444'),
      },
    ]);
    const service = new ReportsService({ $queryRaw: queryRaw } as never);

    const result = await service.cashFlowByClient(actor, {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-11-01T00:00:00.000Z'),
      groupBy: 'month',
    });

    expect(result.rows[0]).toMatchObject({
      currency: 'BRL',
      received_amount: '75.5555',
      paid_expenses: '12.1111',
      net_cash: '63.4444',
    });
    const query = queryRaw.mock.calls[0]?.[0];
    expect(query?.sql).toContain('pa.reversed_at IS NULL');
    expect(query?.sql).toContain("p.status = 'CONFIRMED'");
    expect(query?.sql).toContain("status = 'PAID'");
  });
});
