import { Prisma } from '@livio/db';
import type { AuthenticatedActor } from '@livio/shared';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '../common/security';
import { FinanceService } from './finance.service';

const actor: AuthenticatedActor = {
  userId: 'user-a',
  sessionId: 'session-a',
  organizationId: 'org-a',
  permissions: [],
};

describe('FinanceService transacional', () => {
  it('cria parcelas cuja soma decimal corresponde ao recebível e audita', async () => {
    const created = { id: 'receivable-a', installments: [{ sequence: 1 }, { sequence: 2 }] };
    const create = vi.fn().mockResolvedValue(created);
    const transaction = { receivable: { create } };
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-a' }) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const audit = { record: vi.fn() };
    const service = new FinanceService(prisma as never, audit as never);
    const result = await service.createReceivable(actor, {
      clientId: 'client-a',
      reference: 'HON-1',
      description: 'Honorários',
      originalAmount: '100.00',
      currency: 'BRL',
      issueDate: new Date('2026-08-01'),
      installments: [
        { sequence: 1, amount: '33.33', dueDate: new Date('2026-09-01') },
        { sequence: 2, amount: '66.67', dueDate: new Date('2026-10-01') },
      ],
    });
    expect(result).toBe(created);
    expect(create.mock.calls[0]![0].data.installments.create).toHaveLength(2);
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it('retorna o mesmo pagamento para repetição idempotente inclusive com saldo zero', async () => {
    const input = {
      clientId: 'client-a',
      reference: 'PIX-1',
      amount: '100.00',
      currency: 'BRL',
      paidAt: new Date('2026-08-01'),
      method: 'PIX',
      allocations: [{ installmentId: 'installment-a', amount: '100.00' }],
    };
    const existing = {
      id: 'payment-a',
      amount: new Prisma.Decimal('100'),
      idempotencyHash: sha256(JSON.stringify(input)),
      allocations: [{ amount: new Prisma.Decimal('100') }],
    };
    const transaction = { payment: { findUnique: vi.fn().mockResolvedValue(existing) } };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const service = new FinanceService(prisma as never, { record: vi.fn() } as never);
    await expect(service.createPayment(actor, 'same-key', input)).resolves.toMatchObject({
      payment: existing,
      unappliedAmount: '0.00',
      idempotent: true,
    });
  });

  it('repete conflito serializável e evita duplicação concorrente', async () => {
    const input = {
      clientId: 'client-a',
      reference: 'PIX-2',
      amount: '50.00',
      currency: 'BRL',
      paidAt: new Date('2026-08-01'),
      method: 'PIX',
      allocations: [],
    };
    const existing = {
      id: 'payment-b',
      amount: new Prisma.Decimal('50'),
      idempotencyHash: sha256(JSON.stringify(input)),
      allocations: [],
    };
    const conflict = new Prisma.PrismaClientKnownRequestError('serialization conflict', {
      code: 'P2034',
      clientVersion: '6.19.3',
    });
    const transaction = { payment: { findUnique: vi.fn().mockResolvedValue(existing) } };
    const prisma = {
      $transaction: vi
        .fn()
        .mockRejectedValueOnce(conflict)
        .mockImplementation(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const service = new FinanceService(prisma as never, { record: vi.fn() } as never);
    await expect(service.createPayment(actor, 'concurrent-key', input)).resolves.toMatchObject({
      idempotent: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('estorna sem apagar o pagamento, com controle otimista e auditoria', async () => {
    const payment = {
      id: 'payment-a',
      organizationId: 'org-a',
      status: 'CONFIRMED',
      version: 3,
      allocations: [],
    };
    const reversal = { id: 'reversal-a', originalPaymentId: payment.id };
    const transaction = {
      $queryRaw: vi.fn(),
      payment: {
        findFirst: vi.fn().mockResolvedValue(payment),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      paymentAllocation: { updateMany: vi.fn() },
      paymentReversal: { create: vi.fn().mockResolvedValue(reversal) },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const audit = { record: vi.fn() };
    const service = new FinanceService(prisma as never, audit as never);
    await expect(
      service.reversePayment(actor, payment.id, { reason: 'Duplicidade confirmada' }),
    ).resolves.toBe(reversal);
    expect(transaction.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 3, status: 'CONFIRMED' }),
      }),
    );
    expect(transaction.paymentReversal.create).toHaveBeenCalledOnce();
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ action: 'REVERSE', resource: 'payment' }),
    );
  });
});
