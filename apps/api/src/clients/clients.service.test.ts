import { ConflictException } from '@nestjs/common';
import { Prisma } from '@livio/db';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedActor } from '@livio/shared';
import { ClientsService } from './clients.service';

const actor: AuthenticatedActor = {
  userId: 'user-a',
  organizationId: 'organization-a',
  permissions: ['clients:create'],
};

describe('ClientsService.create', () => {
  it('nega ficha e resumo de outro cliente antes de consultar dados relacionados', async () => {
    const findFirst = vi.fn();
    const service = new ClientsService({ client: { findFirst } } as never, {} as never);
    const portal = { ...actor, clientId: 'client-a' };
    await expect(service.get(portal, 'client-b')).rejects.toThrow('Cliente não encontrado');
    await expect(service.overview(portal, 'client-b')).rejects.toThrow('Cliente não encontrado');
    expect(findFirst).not.toHaveBeenCalled();
  });
  it('returns a conflict when a CPF/CNPJ is already registered in the organization', async () => {
    const duplicateTaxId = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['organization_id', 'tax_id_normalized'] },
    });
    const transaction = { client: { create: vi.fn().mockRejectedValue(duplicateTaxId) } };
    const prisma = {
      $transaction: vi.fn((operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const service = new ClientsService(prisma as never, { record: vi.fn() } as never);

    const result = service.create(actor, {
      type: 'PERSON',
      displayName: 'Cliente existente',
      taxId: '529.982.247-25',
    });
    const error = await result.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toHaveProperty('message', 'Este CPF/CNPJ já está cadastrado nesta organização.');
  });

  it('creates and audits a client without a tax ID', async () => {
    const client = {
      id: 'client-a',
      organizationId: actor.organizationId,
      type: 'PERSON',
      displayName: 'Cliente sem documento',
    };
    const transaction = { client: { create: vi.fn().mockResolvedValue(client) } };
    const prisma = {
      $transaction: vi.fn((operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new ClientsService(prisma as never, audit as never);

    await expect(
      service.create(actor, { type: 'PERSON', displayName: 'Cliente sem documento' }),
    ).resolves.toEqual(client);
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ action: 'CREATE', resourceId: client.id }),
    );
  });
});

describe('ClientsService.overview', () => {
  it('agrupa as consultas autorizadas em uma transação para reutilizar uma conexão', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'client-a',
      contacts: [],
      matters: [],
      contracts: [],
      receivables: [],
      payments: [],
      documents: [],
      tasks: [],
      calendarEvents: [],
      internalNotes: [],
      clientMessages: [],
    });
    const findTimeline = vi.fn().mockResolvedValue([]);
    const transaction = {
      client: { findFirst },
      activityEvent: { findMany: findTimeline },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const service = new ClientsService(prisma as never, {} as never, {} as never);
    const overviewActor = {
      ...actor,
      permissions: [
        'matters:view',
        'contracts:view',
        'receivables:view',
        'payments:view',
        'documents:view',
        'tasks:view',
        'calendar:view',
        'notes:view',
        'messages:view',
        'audit:view',
      ],
    } satisfies AuthenticatedActor;

    const result = await service.overview(overviewActor, 'client-a');

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(findFirst).toHaveBeenCalledOnce();
    expect(result.financial.outstanding).toEqual([]);
    expect(result.client).toMatchObject({ id: 'client-a' });
    expect(result.client.contacts).toEqual(result.contacts);
    expect(findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: 'client-a', organizationId: actor.organizationId, deletedAt: null },
      relationLoadStrategy: 'join',
      include: {
        matters: { where: { organizationId: actor.organizationId, clientId: 'client-a' } },
        receivables: { where: { organizationId: actor.organizationId, clientId: 'client-a' } },
        payments: { where: { organizationId: actor.organizationId, clientId: 'client-a' } },
      },
    });
    expect(findTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: actor.organizationId,
          subjectType: 'client',
          subjectId: 'client-a',
        },
      }),
    );
  });

  it('preserva totais em 75 recebíveis sintéticos e estados parcial, integral e vencido', async () => {
    const dueDate = new Date('2030-01-01T00:00:00.000Z');
    const balanceRows = Array.from({ length: 75 }, (_, index) => ({
      currency: 'BRL',
      status: 'OPEN',
      installments: [
        {
          amount: new Prisma.Decimal('1.00'),
          status:
            index === 1
              ? 'PARTIALLY_PAID'
              : index === 2
                ? 'PAID'
                : index === 3
                  ? 'OVERDUE'
                  : 'OPEN',
          allocations:
            index === 1
              ? [{ amount: new Prisma.Decimal('0.25') }]
              : index === 2
                ? [{ amount: new Prisma.Decimal('1.00') }]
                : [],
          adjustments: [],
        },
      ],
    }));
    const receivableRows = balanceRows.slice(0, 50).map((row, index) => ({
      id: `receivable-${index}`,
      reference: `QA-${index}`,
      description: 'Recebível sintético',
      status: row.status,
      contractId: null,
      originalAmount: new Prisma.Decimal('1.00'),
      currency: row.currency,
      dueDate,
      installments: [
        {
          id: `installment-${index}`,
          sequence: 1,
          status: row.installments[0]!.status,
          amount: new Prisma.Decimal('1.00'),
          dueDate,
          allocations: row.installments[0]!.allocations,
          adjustments: [],
        },
      ],
    }));
    const findFirst = vi.fn().mockResolvedValue({
      id: 'client-a',
      contacts: [],
      receivables: [...receivableRows, ...balanceRows.slice(50)],
    });
    const transaction = {
      client: { findFirst },
      activityEvent: { findMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const service = new ClientsService(prisma as never, {} as never, {} as never);
    const overviewActor = {
      ...actor,
      permissions: ['receivables:view'],
    } satisfies AuthenticatedActor;

    const result = await service.overview(overviewActor, 'client-a');

    expect(result.financial.receivables).toHaveLength(50);
    expect(result.financial.outstanding).toEqual([{ currency: 'BRL', amount: '73.7500' }]);
    expect(findFirst).toHaveBeenCalledOnce();
    expect(findFirst.mock.calls[0]![0]).toMatchObject({ relationLoadStrategy: 'join' });
  });

  it('não consulta o resumo quando o cliente não pertence à organização autenticada', async () => {
    const clientFindFirst = vi.fn().mockResolvedValue(null);
    const transaction = {
      client: { findFirst: clientFindFirst },
      activityEvent: { findMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const service = new ClientsService(prisma as never, {} as never, {} as never);

    await expect(
      service.overview({ ...actor, organizationId: 'organization-other' }, 'client-a'),
    ).rejects.toThrow('Cliente não encontrado');

    expect(clientFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'client-a',
        organizationId: 'organization-other',
        deletedAt: null,
      },
      include: { contacts: true },
      relationLoadStrategy: 'join',
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});
