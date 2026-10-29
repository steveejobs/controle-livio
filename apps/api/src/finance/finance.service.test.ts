import { Prisma } from '@livio/db';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
  it.each(['listContracts', 'listReceivables', 'listPayments'] as const)(
    '%s preserva o cliente do portal ao receber filtro de outro cliente',
    async (method) => {
      const findMany = vi.fn().mockResolvedValue([]);
      const count = vi.fn().mockResolvedValue(0);
      const model = { findMany, count };
      const prisma = {
        contract: model,
        receivable: model,
        payment: model,
        $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      };
      const service = new FinanceService(prisma as never, {} as never);
      await service[method](
        { ...actor, clientId: 'client-a' },
        { clientId: 'client-b', page: 1, pageSize: 25 },
      );
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: actor.organizationId,
            clientId: 'client-a',
          }),
        }),
      );
    },
  );
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

  it('cria audiência agendada e alertas configurados na mesma transação do contrato', async () => {
    const startsAt = new Date('2030-05-21T13:00:00.000Z');
    const event = { id: 'hearing-a', startsAt };
    const createEvent = vi.fn().mockResolvedValue(event);
    const createNotification = vi.fn().mockResolvedValue({});
    const contractCreate = vi.fn().mockResolvedValue({ id: 'contract-hearing' });
    const transaction = {
      contract: { create: contractCreate },
      calendarEvent: { create: createEvent },
      notification: { create: createNotification },
    };
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-a' }) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new FinanceService(prisma as never, audit as never);

    await service.createContract(actor, {
      clientId: 'client-a',
      number: 'CTR-HEARING',
      title: 'Defesa criminal',
      feeModel: 'FIXED',
      currency: 'BRL',
      serviceNames: ['Acompanhamento em delegacia'],
      hearings: [
        {
          startsAt,
          reminderMinutes: [45, 10],
        },
      ],
    });

    expect(createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client-a',
        title: 'Audiência · Defesa criminal',
        type: 'HEARING',
        status: 'SCHEDULED',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
      }),
    });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          title: 'Audiência em 45 min',
          link: 'calendar:event:hearing-a',
          scheduledAt: new Date(startsAt.getTime() - 45 * 60_000),
          metadata: expect.objectContaining({
            source: 'HEARING_REMINDER',
            eventId: 'hearing-a',
            minutesBefore: 45,
          }),
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ resource: 'calendar_event', resourceId: 'hearing-a' }),
    );
  });

  it('vincula a cobrança selecionada ao contrato com o mesmo valor sem perder auditoria', async () => {
    const created = { id: 'contract-b' };
    const contractCreate = vi.fn().mockResolvedValue(created);
    const receivableFind = vi.fn().mockResolvedValue({
      id: 'receivable-b',
      contractId: null,
      matterId: null,
      originalAmount: new Prisma.Decimal('1200.00'),
      currency: 'BRL',
      status: 'OPEN',
    });
    const receivableUpdate = vi.fn().mockResolvedValue({
      id: 'receivable-b',
      reference: 'HON-2',
      contractId: created.id,
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      receivable: { findFirst: receivableFind, update: receivableUpdate },
      contract: { create: contractCreate },
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-a' }) },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const service = new FinanceService(prisma as never, audit as never);

    await expect(
      service.createContract(actor, {
        clientId: 'client-a',
        number: 'CTR-2',
        title: 'Defesa criminal',
        feeModel: 'FIXED',
        fixedAmount: '1200.00',
        currency: 'BRL',
        serviceNames: ['Acompanhamento em delegacia'],
        receivableId: 'receivable-b',
      }),
    ).resolves.toBe(created);

    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(receivableUpdate).toHaveBeenCalledWith({
      where: { id: 'receivable-b' },
      data: { contractId: 'contract-b' },
    });
    expect(audit.record).toHaveBeenCalledTimes(2);
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

  it.each([
    { firstAmount: '70.00', secondAmount: '40.00' },
    { firstAmount: '40.00', secondAmount: '70.00' },
  ])(
    'impede pagamentos acima do saldo com chaves idempotentes distintas em qualquer ordem',
    async ({ firstAmount, secondAmount }) => {
      const installmentId = '00000000-0000-4000-8000-000000000011';
      const storedPayments: {
        id: string;
        idempotencyKey: string;
        idempotencyHash: string;
        amount: Prisma.Decimal;
        allocations: { amount: Prisma.Decimal }[];
      }[] = [];
      const findUnique = vi.fn(
        async ({
          where,
        }: {
          where: { organizationId_idempotencyKey: { idempotencyKey: string } };
        }) =>
          storedPayments.find(
            ({ idempotencyKey }) =>
              idempotencyKey === where.organizationId_idempotencyKey.idempotencyKey,
          ) ?? null,
      );
      const createPayment = vi.fn(
        async (args: {
          data: {
            idempotencyKey: string;
            idempotencyHash: string;
            amount: Prisma.Decimal;
            allocations: { create: { amount: Prisma.Decimal }[] };
          };
        }) => {
          const payment = {
            id: `payment-${storedPayments.length + 1}`,
            idempotencyKey: args.data.idempotencyKey,
            idempotencyHash: args.data.idempotencyHash,
            amount: args.data.amount,
            allocations: args.data.allocations.create,
          };
          storedPayments.push(payment);
          return payment;
        },
      );
      const transaction = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        payment: { findUnique, create: createPayment },
        receivableInstallment: {
          findMany: vi.fn(async () => [
            {
              id: installmentId,
              amount: new Prisma.Decimal('100.00'),
              currency: 'BRL',
              status: 'OPEN',
              dueDate: new Date('2030-01-01T00:00:00.000Z'),
              receivable: { clientId: 'client-a' },
              allocations: storedPayments.flatMap(({ allocations }) => allocations),
              adjustments: [],
            },
          ]),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      let transactionQueue: Promise<unknown> = Promise.resolve();
      const prisma = {
        $transaction: vi.fn((operation: (tx: unknown) => Promise<unknown>) => {
          const current = transactionQueue.then(() => operation(transaction));
          transactionQueue = current.then(
            () => undefined,
            () => undefined,
          );
          return current;
        }),
      };
      const service = new FinanceService(prisma as never, { record: vi.fn() } as never);
      const makeInput = (reference: string, amount: string) => ({
        clientId: 'client-a',
        reference,
        amount,
        currency: 'BRL',
        paidAt: new Date('2026-08-01'),
        method: 'PIX',
        allocations: [{ installmentId, amount }],
      });

      const results = await Promise.allSettled([
        service.createPayment(
          actor,
          'distinct-key-first',
          makeInput('PIX-DISTINCT-FIRST', firstAmount),
        ),
        service.createPayment(
          actor,
          'distinct-key-second',
          makeInput('PIX-DISTINCT-SECOND', secondAmount),
        ),
      ]);

      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const rejection = results.find(({ status }) => status === 'rejected');
      expect(rejection).toMatchObject({
        status: 'rejected',
        reason: expect.any(BadRequestException),
      });
      const allocated = storedPayments
        .flatMap(({ allocations }) => allocations)
        .reduce((sum, { amount }) => sum.plus(amount), new Prisma.Decimal(0));
      expect(allocated.lessThanOrEqualTo('100.00')).toBe(true);
      expect(findUnique).toHaveBeenCalledTimes(2);
      expect(createPayment).toHaveBeenCalledTimes(1);
      const requestedKeys = findUnique.mock.calls.map(
        ([{ where }]) => where.organizationId_idempotencyKey.idempotencyKey,
      );
      expect(new Set(requestedKeys)).toEqual(
        new Set(['distinct-key-first', 'distinct-key-second']),
      );
    },
  );

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

describe('FinanceService ciclo de despesas', () => {
  function fixture(
    status: 'DRAFT' | 'APPROVED' = 'DRAFT',
    approvalRequired = true,
    otherApprovers = 1,
    dueDate: Date | null = new Date('2026-11-20T00:00:00.000Z'),
  ) {
    let current = {
      id: 'expense-a',
      organizationId: actor.organizationId,
      clientId: null as string | null,
      matterId: null as string | null,
      responsibleUserId: null as string | null,
      description: 'Custas sintéticas',
      category: 'Custas',
      status,
      amount: new Prisma.Decimal('10.2500'),
      currency: 'BRL',
      incurredAt: new Date('2026-10-20T00:00:00.000Z'),
      dueDate,
      paidAt: null as Date | null,
      reimbursable: false,
      approvedById: null as string | null,
      approvedAt: null as Date | null,
      submittedAt: null as Date | null,
      rejectedById: null as string | null,
      rejectedAt: null as Date | null,
      rejectionReason: null as string | null,
      client: null,
      matter: null,
      responsibleUser: null,
      documents: [],
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      organization: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ settings: { expenseApprovalRequired: approvalRequired } }),
      },
      organizationMember: { count: vi.fn().mockResolvedValue(otherApprovers) },
      client: { findFirst: vi.fn().mockResolvedValue(null) },
      matter: { findFirst: vi.fn().mockResolvedValue(null) },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      auditLog: { findFirst: vi.fn().mockResolvedValue({ actorUserId: 'creator' }) },
      expense: {
        findFirst: vi
          .fn()
          .mockImplementation(
            async (args: { where: { id: string; organizationId: string; clientId?: string } }) => {
              if (
                args.where.id !== current.id ||
                args.where.organizationId !== current.organizationId ||
                (args.where.clientId && args.where.clientId !== current.clientId)
              )
                return null;
              return { ...current };
            },
          ),
        updateMany: vi
          .fn()
          .mockImplementation(
            async (args: {
              where: { status?: string | { in: string[] } };
              data: Record<string, unknown>;
            }) => {
              const condition = args.where.status;
              const matches =
                condition === undefined ||
                (typeof condition === 'string'
                  ? current.status === condition
                  : condition.in.includes(current.status));
              if (!matches) return { count: 0 };
              current = { ...current, ...args.data } as typeof current;
              return { count: 1 };
            },
          ),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (
          operation: (tx: unknown) => unknown,
          options?: { maxWait?: number; timeout?: number },
        ) => {
          void options;
          return operation(transaction);
        },
      ),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    return {
      service: new FinanceService(prisma as never, audit as never),
      transaction,
      audit,
      prisma,
      getExpense: () => current,
    };
  }

  it('resume despesas sem somar moedas diferentes e preserva Decimal', async () => {
    const groups = [
      {
        status: 'PENDING_APPROVAL',
        currency: 'BRL',
        _count: { _all: 1 },
        _sum: { amount: new Prisma.Decimal('10.2500') },
      },
      {
        status: 'PAID',
        currency: 'USD',
        _count: { _all: 1 },
        _sum: { amount: new Prisma.Decimal('3.1250') },
      },
    ];
    const groupBy = vi
      .fn()
      .mockResolvedValueOnce(groups)
      .mockResolvedValueOnce([
        {
          currency: 'BRL',
          _count: { _all: 1 },
          _sum: { amount: new Prisma.Decimal('10.2500') },
        },
      ]);
    const service = new FinanceService({ expense: { groupBy } } as never, {} as never);

    await expect(service.expenseSummary(actor, {})).resolves.toEqual({
      currencies: [
        {
          currency: 'BRL',
          pendingApproval: { count: 1, amount: '10.2500' },
          pendingPayment: { count: 0, amount: '0.0000' },
          overdue: { count: 1, amount: '10.2500' },
          paid: { count: 0, amount: '0.0000' },
        },
        {
          currency: 'USD',
          pendingApproval: { count: 0, amount: '0.0000' },
          pendingPayment: { count: 0, amount: '0.0000' },
          overdue: { count: 0, amount: '0.0000' },
          paid: { count: 1, amount: '3.1250' },
        },
      ],
    });
    expect(groupBy).toHaveBeenCalledTimes(2);
    expect(groupBy.mock.calls[0]?.[0]).toMatchObject({
      by: ['status', 'currency'],
      where: { organizationId: actor.organizationId },
    });
  });

  it('submete para aprovação, registra quitação integral exata e audita cada transição', async () => {
    const { service, audit, getExpense, prisma } = fixture();
    const creator = { ...actor, userId: 'creator', permissions: ['expenses:update'] };
    const reviewer = {
      ...actor,
      userId: 'reviewer',
      isAdministrator: true,
      permissions: ['expenses:approve'],
    };

    await expect(service.submitExpense(creator, 'expense-a')).resolves.toMatchObject({
      status: 'PENDING_APPROVAL',
    });
    expect(prisma.$transaction.mock.calls[0]?.[1]).toEqual({
      maxWait: 10_000,
      timeout: 15_000,
    });
    await expect(service.decideExpense(reviewer, 'expense-a', 'APPROVE')).resolves.toMatchObject({
      status: 'APPROVED',
    });
    await expect(
      service.payExpense(creator, 'expense-a', {
        amount: '10.2500',
        paidAt: new Date('2026-11-20T00:00:00.000Z'),
        method: 'PIX',
      }),
    ).resolves.toMatchObject({ status: 'PAID', amount: new Prisma.Decimal('10.2500') });
    expect(getExpense().status).toBe('PAID');
    expect(audit.record).toHaveBeenCalledTimes(3);
  });

  it('impede impasse do único aprovador e permite confirmação explícita sem aprovação', async () => {
    const approvalRequired = fixture('DRAFT', true, 0);
    const soleAdministrator = {
      ...actor,
      userId: 'creator',
      isAdministrator: true,
      permissions: ['expenses:update', 'expenses:approve'],
    };

    await expect(
      approvalRequired.service.submitExpense(soleAdministrator, 'expense-a'),
    ).rejects.toThrow(ConflictException);
    expect(approvalRequired.getExpense().status).toBe('DRAFT');
    expect(approvalRequired.audit.record).not.toHaveBeenCalled();

    const approvalDisabled = fixture('DRAFT', false, 0);
    await expect(
      approvalDisabled.service.submitExpense(soleAdministrator, 'expense-a'),
    ).resolves.toMatchObject({ status: 'APPROVED' });
    expect(approvalDisabled.getExpense().approvedById).toBeNull();
    expect(approvalDisabled.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'UPDATE',
        metadata: { transition: 'CONFIRM', approvalRequired: false },
      }),
    );
  });

  it('não envia despesa legada sem vencimento e mantém isolamento entre organizações', async () => {
    const legacy = fixture('DRAFT', true, 1, null);
    await expect(legacy.service.submitExpense(actor, 'expense-a')).rejects.toThrow(
      BadRequestException,
    );
    expect(legacy.getExpense().status).toBe('DRAFT');

    const isolated = fixture('DRAFT');
    await expect(
      isolated.service.cancelExpense({ ...actor, organizationId: 'org-b' }, 'expense-a'),
    ).rejects.toThrow(NotFoundException);
    expect(isolated.transaction.expense.updateMany).not.toHaveBeenCalled();
    expect(isolated.audit.record).not.toHaveBeenCalled();
  });

  it('impede autoaprovação e rejeita pagamento parcial sem mudar o status', async () => {
    const pending = fixture();
    const creator = { ...actor, userId: 'creator' };
    await pending.service.submitExpense(creator, 'expense-a');
    await expect(pending.service.decideExpense(creator, 'expense-a', 'APPROVE')).rejects.toThrow(
      ForbiddenException,
    );

    const approved = fixture('APPROVED');
    await expect(
      approved.service.payExpense(actor, 'expense-a', {
        amount: '10.2499',
        paidAt: new Date(),
        method: 'PIX',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(approved.getExpense().status).toBe('APPROVED');
    expect(approved.audit.record).not.toHaveBeenCalled();
  });

  it('registra rejeição com responsável e bloqueia pagamento antes de aprovação', async () => {
    const pending = fixture();
    const creator = { ...actor, userId: 'creator' };
    const reviewer = {
      ...actor,
      userId: 'reviewer',
      permissions: ['expenses:approve'],
    };
    await pending.service.submitExpense(creator, 'expense-a');

    await expect(
      pending.service.payExpense(creator, 'expense-a', {
        amount: '10.2500',
        paidAt: new Date('2026-11-20T00:00:00.000Z'),
        method: 'PIX',
      }),
    ).rejects.toThrow(ConflictException);
    await expect(
      pending.service.decideExpense(reviewer, 'expense-a', 'REJECT', 'Falta comprovante'),
    ).resolves.toMatchObject({ status: 'REJECTED', rejectedById: reviewer.userId });
    expect(pending.audit.record).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'UPDATE',
        metadata: { transition: 'REJECT', reason: 'Falta comprovante' },
      }),
    );
    await expect(
      pending.service.payExpense(creator, 'expense-a', {
        amount: '10.2500',
        paidAt: new Date('2026-11-20T00:00:00.000Z'),
        method: 'PIX',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('duas tentativas concorrentes de quitação integral produzem uma única transição', async () => {
    const { service, getExpense } = fixture('APPROVED');
    const input = {
      amount: '10.2500',
      paidAt: new Date('2026-11-20T00:00:00.000Z'),
      method: 'PIX',
    };
    const results = await Promise.allSettled([
      service.payExpense(actor, 'expense-a', input),
      service.payExpense(actor, 'expense-a', input),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(getExpense().status).toBe('PAID');
  });

  it('não permite editar despesa paga ou cancelar após a quitação', async () => {
    const { service } = fixture('APPROVED');
    await service.payExpense(actor, 'expense-a', {
      amount: '10.2500',
      paidAt: new Date(),
      method: 'PIX',
    });
    await expect(
      service.updateExpense(actor, 'expense-a', { description: 'Alteração' }),
    ).rejects.toThrow(ConflictException);
    await expect(service.cancelExpense(actor, 'expense-a')).rejects.toThrow(ConflictException);
  });

  it('confere que o aprovador pertence ao escritório, está ativo e não é o criador', async () => {
    const soleAdministrator = { ...actor, userId: 'only-admin' };
    const pending = fixture('DRAFT', true, 0);
    await expect(pending.service.submitExpense(soleAdministrator, 'expense-a')).rejects.toThrow(
      ConflictException,
    );
    expect(pending.transaction.organizationMember.count).toHaveBeenCalledWith({
      where: {
        organizationId: actor.organizationId,
        userId: { not: 'only-admin' },
        status: 'ACTIVE',
        user: { status: 'ACTIVE', deletedAt: null },
        roles: {
          some: {
            role: {
              permissions: {
                some: {
                  permission: {
                    organizationId: actor.organizationId,
                    resource: 'expenses',
                    action: 'approve',
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('expõe apenas nomes de campos no histórico e aplica escopo de escritório/cliente', async () => {
    const event = {
      id: 'audit-a',
      actorUserId: 'reviewer-a',
      action: 'UPDATE',
      before: { amount: '10.2500', description: 'Antes' },
      after: { amount: '10.2500', description: 'Depois' },
      metadata: { transition: 'REJECT', reason: 'valor privado' },
      createdAt: new Date('2026-10-27T12:00:00.000Z'),
    };
    const findFirst = vi.fn().mockResolvedValue({ id: 'expense-a' });
    const findMany = vi.fn().mockResolvedValue([event]);
    const count = vi.fn().mockResolvedValue(1);
    const members = vi
      .fn()
      .mockResolvedValue([{ userId: 'reviewer-a', user: { fullName: 'Revisor sintético' } }]);
    const transaction = {
      expense: { findFirst },
      auditLog: { findMany, count },
      organizationMember: { findMany: members },
    };
    const prisma = {
      ...transaction,
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = new FinanceService(prisma as never, {} as never);
    const portalActor = { ...actor, clientId: 'client-a', permissions: ['expenses:view'] };

    await expect(
      service.expenseHistory(portalActor, 'expense-a', { page: 1, pageSize: 10 }),
    ).resolves.toEqual({
      items: [
        {
          id: 'audit-a',
          action: 'UPDATE',
          transition: 'REJECT',
          occurredAt: event.createdAt,
          actorName: 'Revisor sintético',
          changedFields: ['description'],
        },
      ],
      total: 1,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'expense-a', organizationId: actor.organizationId, clientId: 'client-a' },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: actor.organizationId,
          resource: 'expense',
          resourceId: 'expense-a',
        },
      }),
    );
    expect(members).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: actor.organizationId, userId: { in: ['reviewer-a'] } },
      }),
    );
  });

  it('retorna comprovantes somente com permissão e, no portal, somente os visíveis ao cliente', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      expense: { findMany, count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = new FinanceService(prisma as never, {} as never);
    const query = { page: 1, pageSize: 10, period: 'dueDate' as const };

    await service.listExpenses({ ...actor, permissions: [] }, query);
    expect(findMany.mock.calls[0]?.[0].include).not.toHaveProperty('documents');

    await service.listExpenses(
      { ...actor, clientId: 'client-a', permissions: ['documents:view'] },
      query,
    );
    expect(findMany.mock.calls[1]?.[0].include.documents).toEqual({
      where: { deletedAt: null, visibility: 'CLIENT', clientId: 'client-a' },
      select: { id: true, title: true, visibility: true },
    });
  });
});
