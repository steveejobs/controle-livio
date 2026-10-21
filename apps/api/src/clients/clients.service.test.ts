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
