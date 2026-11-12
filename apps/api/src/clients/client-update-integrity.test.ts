import { ConflictException } from '@nestjs/common';
import { Prisma } from '@livio/db';
import { expect, it, vi } from 'vitest';
import { ClientsService } from './clients.service';

const actor = {
  organizationId: 'synthetic-org',
  userId: 'synthetic-user',
  permissions: ['clients:update'],
};

it('returns the same 409 for a duplicate tax ID on update as on creation', async () => {
  const error = new Prisma.PrismaClientKnownRequestError('Synthetic unique error', {
    code: 'P2002',
    clientVersion: Prisma.prismaVersion.client,
    meta: { target: ['organization_id', 'tax_id_normalized'] },
  });
  const tx = { client: { update: vi.fn().mockRejectedValue(error) } };
  const service = new ClientsService(
    { $transaction: (f: (db: typeof tx) => unknown) => f(tx) } as never,
    {} as never,
    {} as never,
  );
  vi.spyOn(service, 'get').mockResolvedValue({ id: 'synthetic-client' } as never);
  await expect(
    service.update(actor, 'synthetic-client', { taxId: '529.982.247-25' }),
  ).rejects.toBeInstanceOf(ConflictException);
});

it('clears nullable contacts explicitly instead of reporting success while retaining them', async () => {
  const update = vi.fn().mockResolvedValue({ id: 'synthetic-client', email: null, phone: null });
  const tx = { client: { update } };
  const service = new ClientsService(
    { $transaction: (f: (db: typeof tx) => unknown) => f(tx) } as never,
    { record: vi.fn() } as never,
    {} as never,
  );
  vi.spyOn(service, 'get').mockResolvedValue({
    id: 'synthetic-client',
    email: 'old@example.invalid',
    phone: '123',
  } as never);
  await service.update(actor, 'synthetic-client', { email: '', phone: '' });
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ email: null, phone: null }) }),
  );
});

it('uses the reviewed version as a monotonic compare-and-set and reports stale editing as 409', async () => {
  const update = vi.fn().mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('Synthetic stale edit', {
      code: 'P2025',
      clientVersion: Prisma.prismaVersion.client,
    }),
  );
  const tx = { client: { update } };
  const service = new ClientsService(
    { $transaction: (f: (db: typeof tx) => unknown) => f(tx) } as never,
    {} as never,
    {} as never,
  );
  vi.spyOn(service, 'get').mockResolvedValue({ id: 'synthetic-client' } as never);
  const input = { displayName: 'Reviewed edit', expectedUpdatedAt: '2026-11-10T12:00:00.000Z' };
  await expect(service.update(actor, 'synthetic-client', input)).rejects.toBeInstanceOf(
    ConflictException,
  );
  expect(update.mock.calls[0]![0].where).toMatchObject({
    id: 'synthetic-client',
    organizationId: actor.organizationId,
    updatedAt: new Date(input.expectedUpdatedAt),
    deletedAt: null,
  });
  expect(update.mock.calls[0]![0].data.updatedAt.getTime()).toBeGreaterThan(
    new Date(input.expectedUpdatedAt).getTime(),
  );
});
