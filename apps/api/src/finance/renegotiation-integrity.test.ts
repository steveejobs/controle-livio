import { Prisma } from '@livio/db';
import { describe, expect, it, vi } from 'vitest';
import { FinanceService } from './finance.service';

describe('integridade da renegociação', () => {
  it.each(['CANCELLED', 'WRITTEN_OFF', 'OPEN', 'PARTIALLY_PAID', 'OVERDUE'])(
    'respeita o estado %s na renegociação',
    async (status) => {
      const original = {
        id: 'receivable-a',
        status,
        clientId: 'client-a',
        currency: 'BRL',
        installments: [{ id: 'installment-a' }],
      };
      const create = vi.fn().mockResolvedValue({ id: 'duplicate-debt' });
      const transaction = {
        $queryRaw: vi.fn(),
        receivable: { findFirst: vi.fn().mockResolvedValue(original), update: vi.fn(), create },
        receivableInstallment: {
          findFirst: vi.fn().mockResolvedValue({
            amount: new Prisma.Decimal('100'),
            allocations: [],
            adjustments: [],
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        renegotiation: { create: vi.fn().mockResolvedValue({ id: 'renegotiation-a' }) },
      };
      const service = new FinanceService(
        {
          $transaction: vi.fn(async (callback) => callback(transaction)),
        } as never,
        { record: vi.fn() } as never,
      );
      const result = service.renegotiate(
        { organizationId: 'org-a', userId: 'user-a', permissions: [] },
        original.id,
        {
          reference: 'SECOND-RENEGOTIATION',
          description: 'Nova cobrança sintética',
          reason: 'Repetição sintética',
          issueDate: new Date('2026-11-04'),
          installments: [{ sequence: 1, amount: '100.00', dueDate: new Date('2030-01-01') }],
        },
      );
      if (['CANCELLED', 'WRITTEN_OFF'].includes(status)) {
        await expect(result).rejects.toThrow('não está disponível para renegociação');
        expect(create).not.toHaveBeenCalled();
        expect(transaction.receivable.update).not.toHaveBeenCalled();
      } else {
        await expect(result).resolves.toMatchObject({
          resultingReceivable: { id: 'duplicate-debt' },
        });
        expect(create).toHaveBeenCalledOnce();
      }
    },
  );
});
