import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedActor } from '@livio/shared';
import { describe, expect, it, vi } from 'vitest';
import { MattersService } from './matters.service';
import { createMatterSchema } from './matter.schemas';

const actor: AuthenticatedActor = {
  userId: 'user-a',
  sessionId: 'session-a',
  organizationId: 'org-a',
  permissions: [],
};

const objectiveMatter = createMatterSchema.parse({
  clientId: '11111111-1111-4111-8111-111111111111',
  pipelineId: '22222222-2222-4222-8222-222222222222',
  reference: 'COB-OBJ-1',
  title: 'Solicitar documentos',
  collectionObjective: { description: 'Aguardar documentos sem negociar valor.' },
});

describe('MattersService collection objectives', () => {
  it('returns the assigned lawyer name scoped to the matter organization', async () => {
    const matter = { id: 'matter-a', responsibleLawyerId: 'lawyer-a' };
    const findMany = vi.fn().mockResolvedValue([{ id: 'lawyer-a', fullName: 'Advogada A' }]);
    const prisma = {
      $transaction: vi.fn().mockResolvedValue([[matter], 1]),
      matter: {
        findMany: vi.fn().mockResolvedValue([matter]),
        count: vi.fn().mockResolvedValue(1),
      },
      user: { findMany },
    };
    const service = new MattersService(prisma as never, {} as never);

    const result = await service.list(actor, { page: 1, pageSize: 25 });

    expect(result.items[0]).toMatchObject({
      id: 'matter-a',
      responsibleLawyer: { id: 'lawyer-a', fullName: 'Advogada A' },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['lawyer-a'] },
        organizationId: 'org-a',
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, fullName: true },
    });
  });

  it('lists only active lawyers from the authenticated organization', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'lawyer-a', fullName: 'Advogada A' }]);
    const service = new MattersService({ user: { findMany } } as never, {} as never);

    await expect(service.listResponsibleLawyers(actor)).resolves.toEqual([
      { id: 'lawyer-a', fullName: 'Advogada A' },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-a',
        status: 'ACTIVE',
        clientId: null,
        deletedAt: null,
        roles: { some: { role: { organizationId: 'org-a', key: 'lawyer' } } },
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  });

  it('rejects assigning a non-lawyer as the responsible lawyer', async () => {
    const userFindFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      user: { count: vi.fn().mockResolvedValue(1), findFirst: userFindFirst },
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-a' }) },
      $transaction: vi.fn(),
    };
    const service = new MattersService(prisma as never, { record: vi.fn() } as never);
    const input = createMatterSchema.parse({
      clientId: '11111111-1111-4111-8111-111111111111',
      responsibleLawyerId: '22222222-2222-4222-8222-222222222222',
      reference: 'PROC-INVALID-LAWYER',
      title: 'Processo com responsável inválido',
    });

    await expect(service.create(actor, input)).rejects.toMatchObject({
      message: 'Advogado responsável inválido',
    });
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          roles: { some: { role: { organizationId: 'org-a', key: 'lawyer' } } },
        }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stores the non-financial objective on a collection matter and audits it', async () => {
    const matter = { id: 'matter-a' };
    const create = vi.fn().mockResolvedValue(matter);
    const transaction = { matter: { create } };
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-a' }) },
      pipeline: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'pipeline-a' })
          .mockResolvedValueOnce({ kind: 'COLLECTION' }),
      },
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(transaction)),
    };
    const audit = { record: vi.fn() };
    const service = new MattersService(prisma as never, audit as never);

    await expect(service.create(actor, objectiveMatter)).resolves.toBe(matter);
    expect(create.mock.calls[0]![0].data.customFields).toEqual({
      collectionObjective: {
        kind: 'NON_FINANCIAL',
        description: 'Aguardar documentos sem negociar valor.',
      },
    });
    expect(audit.record).toHaveBeenCalledOnce();
  });

  it('rejects a non-financial collection objective in a non-collection pipeline', async () => {
    const prisma = {
      client: { findFirst: vi.fn().mockResolvedValue({ id: 'client-a' }) },
      pipeline: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'pipeline-a' })
          .mockResolvedValueOnce({ kind: 'LEGAL' }),
      },
      $transaction: vi.fn(),
    };
    const service = new MattersService(prisma as never, { record: vi.fn() } as never);

    await expect(service.create(actor, objectiveMatter)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('builds a permission-scoped chronological matter timeline', async () => {
    const older = new Date('2026-08-01T12:00:00.000Z');
    const newer = new Date('2026-10-01T12:00:00.000Z');
    const prisma = {
      matter: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'matter-a',
          reference: 'PROC-1',
          title: 'Acompanhamento',
          courtNumberNormalized: '0001234',
          area: 'Criminal',
          status: 'ACTIVE',
          client: { id: 'client-a', displayName: 'Marina Souza' },
          parties: [],
          pipeline: null,
          currentStage: null,
          stageHistory: [
            {
              id: 'movement-a',
              fromStage: null,
              toStage: { name: 'Cadastro' },
              reason: null,
              movedAt: older,
            },
          ],
        }),
      },
      task: { findMany: vi.fn().mockResolvedValue([]) },
      calendarEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'hearing-a',
            title: 'Audiência de instrução',
            type: 'HEARING',
            status: 'SCHEDULED',
            startsAt: newer,
            createdAt: older,
          },
        ]),
      },
      internalNote: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'note-a', body: 'Preparar documentos', createdAt: newer }]),
      },
      document: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'document-a', title: 'Procuração', category: 'PROCURACAO', createdAt: older },
          ]),
      },
      clientMessage: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new MattersService(prisma as never, {} as never);
    const timelineActor: AuthenticatedActor = {
      ...actor,
      permissions: ['matters:view', 'tasks:view', 'calendar:view', 'notes:view', 'documents:view'],
    };

    const result = await service.timeline(timelineActor, 'matter-a');

    expect(result.matter).toMatchObject({
      reference: 'PROC-1',
      client: { displayName: 'Marina Souza' },
    });
    expect(result.entries.map(({ type }) => type)).toEqual([
      'HEARING',
      'NOTE',
      'STAGE',
      'DOCUMENT',
    ]);
    expect(prisma.internalNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-a', matterId: 'matter-a' }),
      }),
    );
  });
});
