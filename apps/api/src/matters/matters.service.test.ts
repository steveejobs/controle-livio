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
});
