import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { StorageRecoveryService } from './storage-recovery.service';
import { assertRecoveryAdministrator } from './storage-recovery-admin.service';
import {
  assertRecoveryTransition,
  objectBelongsToOrganization,
  recoveryDecision,
  recoveryErrorCode,
  sha256,
} from './storage-recovery.domain';

const organizationId = '10000000-0000-4000-8000-000000000001';
const bytes = Buffer.from('SYNTHETIC RECOVERY TEST - NO LEGAL VALUE');

// In-memory fault isolation only. No claim of PostgreSQL locks, provider RLS,
// physical persistence, real process death or restore is made by these tests.
function fixture(purpose = 'DOCUMENT') {
  const bucket =
    purpose === 'PHOTO'
      ? 'client-photos'
      : purpose === 'SIGNATURE'
        ? 'document-signatures'
        : 'legal-documents';
  let row = {
    id: randomUUID(),
    organizationId,
    ownerToken: randomUUID(),
    purpose,
    bucket,
    objectKey:
      purpose === 'PHOTO'
        ? `${organizationId}/clients/test/test.png`
        : `organizations/${organizationId}/documents/test/synthetic.pdf`,
    resourceId: randomUUID(),
    resourceType: 'document',
    expectedSha256: sha256(bytes),
    observedSha256: null,
    abandonedAt: null,
    state: 'PLANNED',
    attempts: 0,
    generation: 0,
    leaseUntil: new Date(Date.now() + 900000),
    dueAt: new Date(0),
    legalHold: false,
    attachedAt: null,
    cleanupStartedAt: null,
    completedAt: null,
    lastErrorCode: null,
  };
  let physical: Buffer | null = null,
    refs: Array<{ organization_id: string; kind: string }> = [],
    failCommit = false;
  const events: string[] = [];
  const tx = {
    storageRecoveryEvent: { count: vi.fn(async () => (events.includes('UPLOADING') ? 1 : 0)) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('pg_trigger')) return [{ count: 4 }];
      if (sql.includes('AS present')) return [{ present: physical !== null }];
      if (sql.includes('UNION ALL')) return refs;
      return [{ id: row.id }];
    }),
    storageUploadIntent: {
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      update: vi.fn(async ({ data }: { data: object }) => {
        row = { ...row, ...data };
        events.push(row.state);
        return { ...row };
      }),
      findMany: vi.fn(async () => [{ ...row }]),
    },
    storageRecoveryIncident: {
      upsert: vi.fn(async ({ create }: { create: object }) => ({
        ...create,
        id: 'incident',
        state: 'OPEN',
        notificationId: null,
      })),
      update: vi.fn(async ({ data }: { data: object }) => data),
    },
    organizationMember: { findFirst: vi.fn().mockResolvedValue(null) },
    notification: { create: vi.fn() },
  };
  let transactionActive = 0;
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const before = { ...row };
      transactionActive++;
      try {
        const result = await fn(tx);
        if (failCommit && physical === null && row.state === 'ABSENT') {
          failCommit = false;
          throw new Error('INJECTED_SQL_COMMIT_FAILURE');
        }
        return result;
      } catch (e) {
        row = before;
        throw e;
      } finally {
        transactionActive--;
      }
    }),
  };
  const storage = {
    inspect: vi.fn(async () => {
      expect(transactionActive).toBe(0);
      return physical
        ? { status: 'PRESENT', sha256: sha256(physical), size: physical.length }
        : { status: 'ABSENT' };
    }),
    upload: vi.fn(async (_key: string, value: Buffer) => {
      if (physical) throw new Error('CONFLICT');
      physical = Buffer.from(value);
    }),
    remove: vi.fn(async () => {
      expect(transactionActive).toBe(0);
      physical = null;
    }),
  };
  const config = { get: vi.fn().mockReturnValue(true) },
    audit = { record: vi.fn() };
  const service = () =>
    new StorageRecoveryService(prisma as never, storage as never, audit as never, config as never);
  const ticket = { id: row.id, organizationId, ownerToken: row.ownerToken };
  return {
    service,
    storage,
    prisma,
    tx,
    ticket,
    events,
    config,
    get row() {
      return row;
    },
    get physical() {
      return physical;
    },
    expire() {
      row.leaseUntil = new Date(0);
      row.dueAt = new Date(0);
    },
    setRefs(value: typeof refs) {
      refs = value;
    },
    setPhysical(value: Buffer | null) {
      physical = value;
    },
    patch(value: object) {
      row = { ...row, ...value };
    },
    failAfterRemoval() {
      failCommit = true;
    },
  };
}

describe.each(['DOCUMENT', 'VERSION', 'PHOTO', 'SIGNATURE', 'SIGNED_PDF'])(
  '%s recovery contract (unit isolation)',
  (purpose) => {
    it('keeps the durable plan when inspection fails before upload', async () => {
      const f = fixture(purpose),
        failure = new Error('SYNTHETIC_SCANNER_REJECTED');
      await expect(
        f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(f.row.state).toBe('PLANNED');
      expect(f.storage.upload).not.toHaveBeenCalled();
      await f.service().compensate(f.ticket, failure);
      expect(f.row.state).toBe('ABSENT');
      expect(f.row.dueAt.getTime()).toBeGreaterThan(Date.now());
    });
    it('accepts an ambiguous upload only after reading the exact intended bytes', async () => {
      const f = fixture(purpose);
      f.storage.upload.mockImplementationOnce(async (_key, value) => {
        f.setPhysical(value);
        throw new Error('PROVIDER_TIMEOUT');
      });
      await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
      expect(f.row.state).toBe('OBJECT_CREATED');
      expect(f.row.observedSha256).toBe(sha256(bytes));
      await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
      expect(f.storage.upload).toHaveBeenCalledOnce();
    });
    it('compensates an object after the domain SQL transaction rolls back', async () => {
      const f = fixture(purpose);
      await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
      await expect(
        f.prisma.$transaction(async () => {
          throw new Error('INJECTED_DOMAIN_SQL_FAILURE');
        }),
      ).rejects.toThrow();
      await f.service().compensate(f.ticket, new Error('INJECTED_DOMAIN_SQL_FAILURE'));
      expect(f.physical).toBeNull();
      expect(f.row.state).toBe('ABSENT');
      expect(f.events).toContain('DELETING');
    });
    it('persists bounded retries and an undelivered incident after eight failures', async () => {
      const f = fixture(purpose);
      await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
      f.storage.remove.mockRejectedValue(new Error('INJECTED_REMOVAL_FAILURE'));
      await expect(f.service().compensate(f.ticket)).rejects.toMatchObject({ status: 503 });
      for (let attempt = 1; attempt < 8; attempt++) {
        f.expire();
        await f.service().recoverOne(f.row.id);
      }
      expect(f.row.state).toBe('INCIDENT');
      expect(f.row.attempts).toBe(8);
      expect(f.physical).toEqual(bytes);
      expect(f.tx.storageRecoveryIncident.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { notificationUndelivered: true } }),
      );
    });
    it('allows a fresh service instance to observe an abandoned upload (not a crash proof)', async () => {
      const f = fixture(purpose);
      await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
      f.expire();
      await f.service().recoverOne(f.row.id);
      expect(f.row.state).toBe('ABSENT');
      expect(f.physical).toBeNull();
    });
    it('recovers DELETING after removal succeeds and its SQL commit fails', async () => {
      const f = fixture(purpose);
      await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
      f.expire();
      f.failAfterRemoval();
      await expect(f.service().recoverOne(f.row.id)).rejects.toThrow('INJECTED_SQL_COMMIT_FAILURE');
      expect(f.row.state).toBe('DELETING');
      expect(f.physical).toBeNull();
      f.expire();
      await f.service().recoverOne(f.row.id);
      expect(f.row.state).toBe('ABSENT');
      expect(f.storage.remove).toHaveBeenCalledOnce();
    });
    it('fences attachment but permits a genuinely in-flight upload to finish before reconciliation', async () => {
      const f = fixture(purpose);
      f.storage.upload.mockRejectedValueOnce(
        Object.assign(new Error('TIMEOUT'), { code: 'ETIMEDOUT' }),
      );
      await expect(
        f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {}),
      ).rejects.toThrow();
      await expect(
        f.service().compensate(f.ticket, new Error('ORIGINAL_TIMEOUT')),
      ).rejects.toMatchObject({ status: 503 });
      expect(f.row.state).toBe('UPLOADING');
      expect(f.row.abandonedAt).toBeTruthy();
      expect(f.row.cleanupStartedAt).toBeNull();
      expect((await f.service().recoverOne(f.row.id, f.ticket)).status).toBe('SKIPPED');
      await expect(
        f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {}),
      ).rejects.toThrow();
      await expect(
        f.prisma.$transaction((tx) => f.service().lockForAttachment(tx, f.ticket)),
      ).rejects.toThrow();
      f.setPhysical(bytes);
      f.expire();
      expect((await f.service().recoverOne(f.row.id)).status).toBe('ABSENT');
      expect(f.physical).toBeNull();
    });
    it('continues observing ABSENT and detects a late object', async () => {
      const f = fixture(purpose);
      await f.service().compensate(f.ticket);
      f.setPhysical(bytes);
      f.expire();
      await f.service().recoverOne(f.row.id);
      expect(f.row.state).toBe('ABSENT');
      expect(f.storage.remove).toHaveBeenCalledOnce();
      expect(f.events).toContain('RECONCILE_PENDING');
    });
    it('preserves a reference and never calls removal even with a cleanup ticket', async () => {
      const f = fixture(purpose);
      await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
      f.setRefs([{ organization_id: organizationId, kind: 'HISTORICAL_VERSION' }]);
      await f.service().compensate(f.ticket);
      expect(f.row.state).toBe('RETAINED');
      expect(f.storage.remove).not.toHaveBeenCalled();
      expect(f.physical).toEqual(bytes);
    });
  },
);

describe('recovery authorization and integrity', () => {
  it('cannot finalize an observation after another owner fences its claim', async () => {
    const f = fixture();
    await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
    f.expire();
    const inspect = f.storage.inspect.getMockImplementation()!;
    f.storage.inspect.mockImplementationOnce(async () => {
      const observation = await inspect();
      f.patch({ ownerToken: randomUUID() });
      return observation;
    });
    expect((await f.service().recoverOne(f.row.id)).status).toBe('SKIPPED');
    expect(f.storage.remove).not.toHaveBeenCalled();
    expect(f.physical).toEqual(bytes);
  });
  it('preserves the durable upload when the claim loses its SQL connection', async () => {
    const f = fixture();
    await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
    f.expire();
    f.prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('CONNECTION_LOST'), { code: 'P1017' }),
    );
    await expect(f.service().recoverOne(f.row.id)).rejects.toMatchObject({ code: 'P1017' });
    expect(f.row.state).toBe('OBJECT_CREATED');
    expect(f.physical).toEqual(bytes);
    expect(f.storage.remove).not.toHaveBeenCalled();
  });
  it.each([
    {
      organizationId,
      userId: 'user',
      permissions: ['storage_recovery:manage'],
      isAdministrator: false,
    },
    { organizationId, userId: 'user', permissions: [], isAdministrator: true },
    {
      organizationId,
      userId: 'user',
      permissions: ['storage_recovery:manage'],
      isAdministrator: true,
      clientId: 'client',
    },
    {
      organizationId: '',
      userId: 'user',
      permissions: ['storage_recovery:manage'],
      isAdministrator: true,
    },
  ])('rejects an invalid administrator before repository access', (actor) => {
    expect(() => assertRecoveryAdministrator(actor, true)).toThrow();
  });
  it.each(['legal-documents', 'document-signatures', 'client-photos'])(
    'rejects foreign and traversal keys in %s',
    (bucket) => {
      expect(
        objectBelongsToOrganization(organizationId, bucket, 'organizations/foreign/test'),
      ).toBe(false);
      expect(
        objectBelongsToOrganization(
          organizationId,
          bucket,
          `organizations/${organizationId}/../other`,
        ),
      ).toBe(false);
    },
  );
  it('never deletes mismatched hashes or foreign references', () => {
    const input = {
      references: 0,
      foreignReference: false,
      legalHold: false,
      expectedSha256: sha256(bytes),
      observation: { status: 'PRESENT' as const, sha256: '0'.repeat(64), size: 1 },
      metadataPresent: true,
    };
    expect(recoveryDecision(input)).toBe('INCIDENT');
    expect(recoveryDecision({ ...input, foreignReference: true })).toBe('INCIDENT');
  });
  it('does not equate an empty provider result with physical absence', async () => {
    const f = fixture();
    await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
    f.storage.remove.mockImplementation(async () => {});
    f.expire();
    const result = await f.service().recoverOne(f.row.id);
    expect(result.error).toBeDefined();
    expect(f.row.state).toBe('RECONCILE_PENDING');
    expect(f.physical).toEqual(bytes);
  });
  it('refuses attachment after the key is fenced for deletion', async () => {
    const f = fixture();
    f.patch({ state: 'DELETING', cleanupStartedAt: new Date() });
    await expect(f.service().lockForAttachment(f.tx as never, f.ticket)).rejects.toThrow();
    expect(() => assertRecoveryTransition('ABSENT', 'OBJECT_CREATED')).toThrow();
  });
  it('preserves retention when the provider is unavailable', async () => {
    const f = fixture();
    f.patch({ state: 'RETAINED', legalHold: true });
    f.expire();
    f.storage.inspect.mockResolvedValue({ status: 'UNKNOWN', code: 'PROVIDER_TIMEOUT' } as never);
    await f.service().recoverOne(f.row.id);
    expect(f.row.state).toBe('RETAINED');
    expect(f.row.lastErrorCode).toBe('PROVIDER_TIMEOUT');
    expect(f.storage.remove).not.toHaveBeenCalled();
  });
  it('records missing referenced files as integrity incidents', async () => {
    const f = fixture();
    f.patch({ state: 'COMPLETE', attachedAt: new Date() });
    f.setRefs([{ organization_id: organizationId, kind: 'VERSION' }]);
    f.expire();
    await f.service().recoverOne(f.row.id);
    expect(f.row.state).toBe('INCIDENT');
    expect(f.row.lastErrorCode).toBe('REFERENCE_WITHOUT_OBJECT');
    expect(f.storage.remove).not.toHaveBeenCalled();
  });
  it('does not authorize cleanup when a completed reference disappears', async () => {
    const f = fixture();
    f.patch({ state: 'COMPLETE', attachedAt: new Date() });
    f.setPhysical(bytes);
    f.expire();
    await f.service().recoverOne(f.row.id);
    expect(f.row.state).toBe('INCIDENT');
    expect(f.row.lastErrorCode).toBe('ATTACHED_REFERENCE_LOST');
    expect(f.physical).toEqual(bytes);
  });
  it('keeps dry-run free of updates, events, incidents and provider writes', async () => {
    const f = fixture();
    f.setPhysical(bytes);
    await f.service().recoverDue(true);
    expect(f.tx.storageUploadIntent.update).not.toHaveBeenCalled();
    expect(f.tx.storageRecoveryIncident.upsert).not.toHaveBeenCalled();
    expect(f.storage.remove).not.toHaveBeenCalled();
    expect(f.storage.upload).not.toHaveBeenCalled();
  });
  it('distinguishes sanitized timeout, authorization, SQL and provider outage', () => {
    expect(recoveryErrorCode({ cause: { name: 'TimeoutError' } })).toBe('PROVIDER_TIMEOUT');
    expect(recoveryErrorCode({ statusCode: 403 })).toBe('PROVIDER_AUTHORIZATION');
    expect(recoveryErrorCode({ code: 'P2002' })).toBe('SQL_P2002');
    expect(recoveryErrorCode({ status: 503 })).toBe('PROVIDER_UNAVAILABLE');
  });
});

it('preserves the primary failure when compensating also fails', async () => {
  const f = fixture(),
    primary = new Error('INJECTED_DOMAIN_SQL_PRIMARY');
  await f.service().store(f.ticket, bytes, 'application/octet-stream', async () => {});
  f.storage.remove.mockRejectedValue(new Error('INJECTED_SECONDARY_REMOVAL'));
  await expect(f.service().compensate(f.ticket, primary)).rejects.toMatchObject({
    status: 503,
    cause: primary,
  });
  expect(f.row.state).toBe('RECONCILE_PENDING');
  expect(f.physical).toEqual(bytes);
});

it('reopens and renotifies an incident when an authorized retry exhausts again', async () => {
  const f = fixture();
  let incident = { id: 'incident', state: 'RESOLVED', notificationId: 'previous-notification' };
  f.tx.storageRecoveryIncident.upsert.mockResolvedValue(incident as never);
  f.tx.storageRecoveryIncident.update.mockImplementation(async ({ data }) => {
    incident = { ...incident, ...data };
    return incident;
  });
  f.tx.organizationMember.findFirst.mockResolvedValue({ userId: 'synthetic-admin' } as never);
  f.tx.notification.create.mockResolvedValue({ id: 'new-notification' } as never);
  await f
    .service()
    .incident(
      f.tx as never,
      { organizationId, bucket: f.row.bucket, objectKey: f.row.objectKey, id: f.row.id },
      'RECOVERY_RETRIES_EXHAUSTED',
    );
  expect(incident.state).toBe('OPEN');
  expect(incident.notificationId).toBe('new-notification');
  expect(f.tx.organizationMember.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        organizationId,
        user: { status: 'ACTIVE', organizationId },
      }),
    }),
  );
  expect(f.tx.notification.create).toHaveBeenCalledOnce();
});

it('never hides an unconfirmed in-flight upload behind provider absence', async () => {
  const f = fixture();
  f.patch({ state: 'UPLOADING' });
  f.events.push('UPLOADING');
  f.expire();
  for (let attempt = 0; attempt < 8; attempt++) {
    f.expire();
    await f.service().recoverOne(f.row.id);
  }
  expect(f.row.state).toBe('INCIDENT');
  expect(f.row.attempts).toBe(8);
  expect(f.storage.remove).not.toHaveBeenCalled();
  expect(f.tx.storageRecoveryIncident.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({ kind: 'RECOVERY_RETRIES_EXHAUSTED' }),
    }),
  );
});
