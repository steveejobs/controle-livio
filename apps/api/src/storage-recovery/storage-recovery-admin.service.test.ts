import { expect, it, vi } from 'vitest';
import { StorageRecoveryAdminService } from './storage-recovery-admin.service';
const actor = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  userId: 'synthetic-admin',
  isAdministrator: true,
  permissions: ['storage_recovery:view'],
};

it('does not allow a foreign incident cursor to reach the tenant query', async () => {
  const prisma = {
    storageRecoveryIncident: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  };
  const service = new StorageRecoveryAdminService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  await expect(
    service.overview(actor, '20000000-0000-4000-8000-000000000001'),
  ).rejects.toMatchObject({ status: 404 });
  expect(prisma.storageRecoveryIncident.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: '20000000-0000-4000-8000-000000000001', organizationId: actor.organizationId },
    }),
  );
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('paginates older incidents deterministically without exporting upload ownership', async () => {
  const incidents = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));
  const findMany = vi.fn().mockResolvedValue(incidents);
  const prisma = {
    storageRecoveryIncident: {
      findFirst: vi.fn().mockResolvedValue({ id: 'cursor' }),
      findMany,
      count: vi.fn().mockResolvedValue(0),
    },
    storageUploadIntent: { count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn((calls: Promise<unknown>[]) => Promise.all(calls)),
  };
  const service = new StorageRecoveryAdminService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    { get: () => false } as never,
  );
  const result = await service.overview(actor, 'cursor');
  expect(result.nextCursor).toBe('49');
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { organizationId: actor.organizationId, state: 'OPEN' },
      cursor: { id: 'cursor' },
      skip: 1,
      orderBy: [{ firstObservedAt: 'asc' }, { id: 'asc' }],
    }),
  );
  const selection = findMany.mock.calls[0]![0].select;
  expect(selection).not.toHaveProperty('ownerToken');
});

function decisionFixture() {
  let active = false;
  const op = {
    id: 'operation',
    organizationId: actor.organizationId,
    ownerToken: 'private-owner',
    generation: 0,
    state: 'INCIDENT',
    legalHold: false,
    attachedAt: null,
    cleanupStartedAt: new Date(),
    purpose: 'DOCUMENT',
    bucket: 'legal-documents',
    objectKey: `organizations/${actor.organizationId}/documents/synthetic/file.pdf`,
    expectedSha256: 'a'.repeat(64),
  };
  const incident = {
    id: 'incident',
    operationId: op.id,
    organizationId: actor.organizationId,
    state: 'OPEN',
    kind: 'RECOVERY_RETRIES_EXHAUSTED',
  };
  const storage = {
    inspect: vi.fn(async () => {
      expect(active).toBe(false);
      return { status: 'PRESENT', sha256: op.expectedSha256 };
    }),
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    storageRecoveryIncident: {
      findFirst: vi.fn(async () => ({ ...incident })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...incident,
        ...data,
      })),
    },
  };
  const prisma = {
    storageRecoveryIncident: tx.storageRecoveryIncident,
    storageUploadIntent: { findFirst: vi.fn(async () => ({ ...op })) },
    $transaction: vi.fn(async (fn: (transaction: typeof tx) => Promise<unknown>) => {
      active = true;
      try {
        return await fn(tx);
      } finally {
        active = false;
      }
    }),
  };
  const recovery = {
    lock: vi.fn(async () => ({ ...op })),
    references: vi.fn().mockResolvedValue([]),
    transition: vi.fn().mockResolvedValue(op),
  };
  const audit = { record: vi.fn() };
  const service = new StorageRecoveryAdminService(
    prisma as never,
    recovery as never,
    storage as never,
    audit as never,
    {} as never,
  );
  const administrator = {
    ...actor,
    permissions: ['storage_recovery:view', 'storage_recovery:manage'],
  };
  return { service, administrator, op, incident, storage, tx, prisma, recovery, audit };
}
it('observes the provider outside SQL and rechecks a manual retry under the operation lock', async () => {
  const f = decisionFixture();
  expect(
    (await f.service.decide(f.administrator, 'incident', 'RETRY', 'Synthetic authorized review'))
      .state,
  ).toBe('RESOLVED');
  expect(f.recovery.transition).toHaveBeenCalledWith(
    f.tx,
    expect.anything(),
    'RECONCILE_PENDING',
    expect.objectContaining({ generation: 1, attempts: 0 }),
  );
  expect(f.audit.record).toHaveBeenCalled();
});
it('rejects a changed claim after manual provider observation without resolving the incident', async () => {
  const f = decisionFixture();
  f.storage.inspect.mockImplementationOnce(async () => {
    f.op.ownerToken = 'different-owner';
    return { status: 'PRESENT', sha256: f.op.expectedSha256 };
  });
  await expect(
    f.service.decide(f.administrator, 'incident', 'RETRY', 'Synthetic authorized review'),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.tx.storageRecoveryIncident.update).not.toHaveBeenCalled();
});
it('retaining a missing reference keeps the restoration incident open', async () => {
  const f = decisionFixture();
  f.incident.kind = 'REFERENCE_WITHOUT_OBJECT';
  expect(
    (await f.service.decide(f.administrator, 'incident', 'RETAIN', 'Synthetic retention review'))
      .state,
  ).toBe('OPEN');
  expect(f.storage.inspect).not.toHaveBeenCalled();
  expect(f.recovery.transition).toHaveBeenCalledWith(f.tx, expect.anything(), 'RETAINED', {
    legalHold: true,
  });
});
it('does not retry a retained object or accept an empty administrative reason', async () => {
  const f = decisionFixture();
  f.op.legalHold = true;
  await expect(
    f.service.decide(f.administrator, 'incident', 'RETRY', 'Synthetic authorized review'),
  ).rejects.toMatchObject({ status: 409 });
  await expect(f.service.decide(f.administrator, 'incident', 'RETRY', '')).rejects.toMatchObject({
    status: 409,
  });
  expect(f.recovery.transition).not.toHaveBeenCalled();
});
