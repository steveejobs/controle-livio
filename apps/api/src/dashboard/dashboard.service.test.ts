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
});
