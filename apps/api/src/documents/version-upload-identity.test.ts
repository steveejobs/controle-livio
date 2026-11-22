import { describe, expect, it } from 'vitest';
import { versionUploadIdentity } from './version-upload-identity';
import { StorageRecoveryService } from '../storage-recovery/storage-recovery.service';

const org = '10000000-0000-4000-8000-000000000001';
const doc = '20000000-0000-4000-8000-000000000001';
const key = (
  organization = org,
  document = doc,
  operation = 'operation',
  name = 'synthetic-recovery-test.pdf',
) => `organizations/${organization}/documents/${document}/${operation.padEnd(36, '0')}-${name}`;

describe('VERSION upload operation identity', () => {
  it('reproduces the published limit violation without reducing the filename', () => {
    const objectKey = key();
    expect(('VERSION:' + objectKey).length).toBeGreaterThan(160);
    expect(versionUploadIdentity(org, doc, objectKey).length).toBeLessThanOrEqual(160);
  });
  it.each(['a.pdf', 'a'.repeat(180) + '.pdf', '\u00e7\u00e3\u6587\u4ef6.pdf'])(
    'is stable and exact for %s',
    (name) => {
      const objectKey = key(org, doc, 'operation', name);
      const identity = versionUploadIdentity(org, doc, objectKey);
      expect(identity).toBe(versionUploadIdentity(org, doc, objectKey));
      expect(identity.length).toBeLessThanOrEqual(160);
      expect(objectKey.endsWith(name)).toBe(true);
    },
  );
  it('distinguishes organizations, documents and separate version operations', () => {
    const keys = [
      key(),
      key('other-org'),
      key(org, 'other-doc'),
      key(org, doc, 'another-operation'),
    ];
    expect(new Set(keys.map((objectKey) => versionUploadIdentity(org, doc, objectKey))).size).toBe(
      4,
    );
  });
  it('preserves valid persisted legacy identities and the full key separately', () => {
    const objectKey = key(org, doc, 'operation', 'a.pdf');
    expect(versionUploadIdentity(org, doc, objectKey)).toBe('VERSION:' + objectKey);
  });
  it('concurrent evaluations of the same operation do not allocate new identities', async () => {
    const identities = await Promise.all(
      Array.from({ length: 20 }, async () => versionUploadIdentity(org, doc, key())),
    );
    expect(new Set(identities).size).toBe(1);
  });
  it('the actual planner reuses an existing intent and rejects a simulated identity collision', async () => {
    const service = new StorageRecoveryService({} as never, {} as never, {} as never, {} as never);
    const objectKey = key();
    const input = {
      organizationId: org,
      purpose: 'VERSION' as const,
      bucket: 'legal-documents',
      key: objectKey,
      resourceType: 'document',
      resourceId: doc,
      expectedSha256: 'a'.repeat(64),
      idempotencyKey: versionUploadIdentity(org, doc, objectKey),
    };
    const row = {
      id: 'intent',
      ownerToken: 'owner',
      organizationId: org,
      bucket: input.bucket,
      objectKey,
      purpose: 'VERSION',
      resourceType: 'document',
      resourceId: doc,
      groupId: null,
      expectedSha256: input.expectedSha256,
    };
    const tx = {
      $queryRaw: async () => [{ present: true }],
      $executeRaw: async () => 0,
      storageUploadIntent: { findUnique: async () => row, findUniqueOrThrow: async () => row },
    };
    const first = await service.planInTransaction(tx as never, input);
    expect(await service.planInTransaction(tx as never, input)).toEqual(first);
    expect(first.id).toBe('intent');
    await expect(
      service.planInTransaction(tx as never, {
        ...input,
        key: key(org, doc, 'colliding-operation'),
      }),
    ).rejects.toThrow();
    await expect(
      service.planInTransaction(tx as never, { ...input, expectedSha256: 'b'.repeat(64) }),
    ).rejects.toThrow();
    await expect(
      service.planInTransaction(tx as never, { ...input, idempotencyKey: 'VERSION:' + objectKey }),
    ).rejects.toThrow();
  });
});
