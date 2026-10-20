import { Prisma } from '@livio/db';
import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service';

describe('resumo do dashboard', () => {
  it('entrega seis meses com dinheiro serializado como string', async () => {
    const rows = [
      {
        month: new Date('2026-08-01T00:00:00.000Z'),
        due_amount: new Prisma.Decimal('1000.25'),
        received_amount: new Prisma.Decimal('400.10'),
        outstanding_amount: new Prisma.Decimal('600.15'),
        installments: 3,
      },
    ];
    const prisma = {
      client: { count: vi.fn().mockResolvedValue(2) },
      matter: { count: vi.fn().mockResolvedValue(4) },
      receivable: { count: vi.fn().mockResolvedValue(1) },
      task: { count: vi.fn().mockResolvedValue(5) },
      $queryRaw: vi.fn().mockResolvedValue(rows),
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const scope = { where: vi.fn(() => ({ organizationId: 'organization-a' })) };
    const service = new DashboardService(prisma as never, scope as never);

    const result = await service.summary();

    expect(result).toEqual(
      expect.objectContaining({
        activeClients: 2,
        activeMatters: 4,
        overdueReceivables: 1,
        openTasks: 5,
        monthlyReceivables: [
          {
            month: '2026-08-01',
            dueAmount: '1000.25',
            receivedAmount: '400.10',
            outstandingAmount: '600.15',
            installments: 3,
          },
        ],
      }),
    );
  });

  it('agrupa todo o período por ano e inclui histórico e projeções', async () => {
    const rows = [
      {
        month: new Date('2020-01-01T00:00:00.000Z'),
        due_amount: new Prisma.Decimal('2500.00'),
        received_amount: new Prisma.Decimal('2000.00'),
        outstanding_amount: new Prisma.Decimal('500.00'),
        installments: 4,
      },
    ];
    const prisma = {
      client: { count: vi.fn().mockResolvedValue(0) },
      matter: { count: vi.fn().mockResolvedValue(0) },
      receivable: { count: vi.fn().mockResolvedValue(0) },
      task: { count: vi.fn().mockResolvedValue(0) },
      $queryRaw: vi.fn().mockResolvedValue(rows),
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const scope = { where: vi.fn(() => ({ organizationId: 'organization-a' })) };
    const service = new DashboardService(prisma as never, scope as never);

    const result = await service.summary('all');
    const query = prisma.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;

    expect(result).toEqual(
      expect.objectContaining({
        period: 'all',
        bucket: 'year',
        monthlyReceivables: [
          expect.objectContaining({ month: '2020-01-01', dueAmount: '2500.00' }),
        ],
      }),
    );
    expect(query.sql).toContain("INTERVAL '1 year'");
    expect(query.sql).toContain("date_trunc('year', i.due_date)");
    expect(query.sql).not.toContain('AND i.due_date >= date_trunc');
  });
});
