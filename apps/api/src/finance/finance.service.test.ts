import { Prisma } from '@livio/db';
import { ForbiddenException } from '@nestjs/common';
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
  it('salva os serviços selecionados e mantém o primeiro como principal para relatórios', async () => {
    const created = { id: 'contract-a' };
    const create = vi.fn().mockResolvedValue(created);
    const transaction = { contract: { create } };
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-a' }) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const service = new FinanceService(prisma as never, { record: vi.fn() } as never);

    await expect(
      service.createContract(actor, {
        clientId: 'client-a',
        number: 'CTR-1',
        title: 'Defesa criminal',
        feeModel: 'FIXED',
        currency: 'BRL',
        serviceNames: ['Acompanhamento em delegacia', 'Habeas corpus'],
      }),
    ).resolves.toBe(created);

    expect(create.mock.calls[0]![0].data).toMatchObject({
      serviceName: 'Acompanhamento em delegacia',
      terms: { services: ['Acompanhamento em delegacia', 'Habeas corpus'] },
    });
  });

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

  it('envia IDs UUID tipados para o bloqueio de parcelas do pagamento', async () => {
    const installmentId = '00000000-0000-4000-8000-000000000001';
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transaction = {
      $queryRaw: queryRaw,
      payment: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'payment-c', allocations: [] }),
      },
      receivableInstallment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: installmentId,
            amount: new Prisma.Decimal('50.00'),
            currency: 'BRL',
            dueDate: new Date('2026-08-01'),
            status: 'OPEN',
            allocations: [],
            adjustments: [],
            receivable: { clientId: 'client-a' },
          },
        ]),
        update: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const service = new FinanceService(prisma as never, { record: vi.fn() } as never);

    await service.createPayment(actor, 'uuid-cast-key', {
      clientId: 'client-a',
      reference: 'PIX-UUID-1',
      amount: '50.00',
      currency: 'BRL',
      paidAt: new Date('2026-08-01'),
      method: 'PIX',
      allocations: [{ installmentId, amount: '50.00' }],
    });

    expect(queryRaw.mock.calls[0]![0].sql).toContain('id IN (?::uuid)');
    expect(queryRaw.mock.calls[0]![0].values).toContain(installmentId);
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

  it('mantém a correção de pagamento pendente até a revisão do Administrador', async () => {
    const paymentId = 'payment-change-a';
    const request = { id: 'request-a', status: 'PENDING', paymentId, createdById: actor.userId };
    const payment = {
      id: paymentId,
      organizationId: actor.organizationId,
      clientId: 'client-a',
      reference: 'PIX-ANTIGO',
      amount: new Prisma.Decimal('100.00'),
      currency: 'BRL',
      paidAt: new Date('2026-10-20'),
      method: 'PIX',
      externalId: null,
      version: 3,
      status: 'CONFIRMED',
      allocations: [],
    };
    const transaction = {
      $queryRaw: vi.fn(),
      payment: { findFirst: vi.fn().mockResolvedValue(payment), updateMany: vi.fn() },
      paymentChangeRequest: { create: vi.fn().mockResolvedValue(request) },
      organizationMember: { findMany: vi.fn().mockResolvedValue([{ userId: 'admin-a' }]) },
      notification: { upsert: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const audit = { record: vi.fn() };
    const push = { notifyUsers: vi.fn().mockResolvedValue({ sent: 1 }) };
    const service = new FinanceService(prisma as never, audit as never, push as never);

    await expect(
      service.requestPaymentChange(actor, paymentId, {
        reference: 'PIX-CORRIGIDO',
        amount: '100.00',
        paidAt: new Date('2026-10-20'),
        method: 'PIX',
        externalId: null,
        allocations: [],
        reason: 'Referência incorreta',
      }),
    ).resolves.toEqual({ request, applied: false });

    expect(transaction.payment.updateMany).not.toHaveBeenCalled();
    expect(transaction.notification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'admin-a', status: 'SENT' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ action: 'CREATE', resource: 'payment_change_request' }),
    );
    expect(push.notifyUsers).toHaveBeenCalledWith(
      actor.organizationId,
      ['admin-a'],
      expect.objectContaining({ title: 'Alteração de pagamento aguardando aprovação' }),
    );
  });

  it('aprova a correção dentro da transação, estorna o original e cria o substituto', async () => {
    const installmentId = '00000000-0000-4000-8000-000000000111';
    const paymentId = 'payment-change-b';
    const requestId = 'request-b';
    const input = {
      reference: 'PIX-CORRIGIDO',
      amount: '120.00',
      paidAt: '2026-10-21T12:00:00.000Z',
      method: 'PIX',
      externalId: null,
      allocations: [{ installmentId, amount: '120.00' }],
      reason: 'Valor lançado incorretamente',
    };
    const request = {
      id: requestId,
      organizationId: actor.organizationId,
      paymentId,
      createdById: 'user-staff',
      status: 'PENDING',
      proposedData: { ...input, baseVersion: 3 },
    };
    const payment = {
      id: paymentId,
      organizationId: actor.organizationId,
      clientId: 'client-a',
      reference: 'PIX-ANTIGO',
      amount: new Prisma.Decimal('100.00'),
      currency: 'BRL',
      paidAt: new Date('2026-10-20'),
      method: 'PIX',
      externalId: null,
      metadata: {},
      version: 3,
      status: 'CONFIRMED',
      allocations: [],
    };
    const correctedPayment = { id: 'payment-new', allocations: [] };
    const reviewedRequest = { ...request, status: 'APPROVED' };
    const transaction = {
      $queryRaw: vi.fn(),
      paymentChangeRequest: {
        findFirst: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue(reviewedRequest),
      },
      payment: {
        findFirst: vi.fn().mockResolvedValue(payment),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue(correctedPayment),
      },
      paymentAllocation: { updateMany: vi.fn() },
      paymentReversal: { create: vi.fn().mockResolvedValue({ id: 'reversal-b' }) },
      receivableInstallment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: installmentId,
            amount: new Prisma.Decimal('200.00'),
            currency: 'BRL',
            dueDate: new Date('2027-01-01'),
            status: 'OPEN',
            receivable: { clientId: 'client-a' },
            allocations: [],
            adjustments: [],
          },
        ]),
        update: vi.fn(),
      },
      notification: { upsert: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const audit = { record: vi.fn() };
    const push = { notifyUsers: vi.fn().mockResolvedValue({ sent: 1 }) };
    const administrator: AuthenticatedActor = {
      ...actor,
      isAdministrator: true,
      permissions: ['payments:approve'],
    };
    const service = new FinanceService(prisma as never, audit as never, push as never);

    await expect(
      service.decidePaymentChange(administrator, requestId, 'APPROVED'),
    ).resolves.toEqual({ request: reviewedRequest, payment: correctedPayment });
    expect(transaction.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: paymentId, status: 'CONFIRMED', version: 3 }),
        data: expect.objectContaining({ status: 'REVERSED' }),
      }),
    );
    expect(transaction.paymentReversal.create).toHaveBeenCalledOnce();
    expect(transaction.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CONFIRMED',
          reference: 'PIX-CORRIGIDO',
          allocations: {
            create: [
              expect.objectContaining({ installmentId, amount: expect.any(Prisma.Decimal) }),
            ],
          },
        }),
      }),
    );
    expect(transaction.paymentChangeRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ action: 'APPROVE', resource: 'payment_change_request' }),
    );
    expect(push.notifyUsers).toHaveBeenCalledWith(
      actor.organizationId,
      ['user-staff'],
      expect.objectContaining({ title: 'Correção de pagamento aprovada' }),
    );
  });

  it('impede não Administrador de decidir uma correção antes de abrir transação', async () => {
    const transaction = vi.fn();
    const prisma = { $transaction: transaction };
    const service = new FinanceService(prisma as never, { record: vi.fn() } as never);

    await expect(service.decidePaymentChange(actor, 'request-c', 'APPROVED')).rejects.toThrow(
      ForbiddenException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('recusa uma solicitação e notifica quem a criou sem alterar o pagamento', async () => {
    const request = {
      id: 'request-d',
      organizationId: actor.organizationId,
      paymentId: 'payment-d',
      createdById: actor.userId,
      status: 'PENDING',
      proposedData: {},
    };
    const reviewedRequest = { ...request, status: 'REJECTED' };
    const transaction = {
      $queryRaw: vi.fn(),
      paymentChangeRequest: {
        findFirst: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue(reviewedRequest),
      },
      payment: { findFirst: vi.fn() },
      notification: { upsert: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const audit = { record: vi.fn() };
    const push = { notifyUsers: vi.fn().mockResolvedValue({ sent: 1 }) };
    const administrator: AuthenticatedActor = {
      ...actor,
      userId: 'admin-a',
      isAdministrator: true,
    };
    const service = new FinanceService(prisma as never, audit as never, push as never);

    await expect(
      service.decidePaymentChange(administrator, request.id, 'REJECTED', {
        note: 'Comprovante insuficiente',
      }),
    ).resolves.toEqual({ request: reviewedRequest, payment: undefined });
    expect(transaction.payment.findFirst).not.toHaveBeenCalled();
    expect(transaction.notification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: actor.userId, status: 'SENT' }),
      }),
    );
    expect(push.notifyUsers).toHaveBeenCalledWith(
      actor.organizationId,
      [actor.userId],
      expect.objectContaining({ title: 'Correção de pagamento recusada' }),
    );
  });
});
