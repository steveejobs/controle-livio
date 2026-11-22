import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assertOwnedStack } from './stack-identity.mjs';
import { validateRecoveryEnvironment } from './environment.mjs';

export async function runtime(env = process.env) {
  validateRecoveryEnvironment(env);
  const require = createRequire(import.meta.url),
    { PrismaClient } = require('@prisma/client');
  const load = (file) => require(resolve('apps/api/dist', file));
  const { parseApiEnvironment } = require('@livio/shared');
  const values = parseApiEnvironment(env),
    config = { get: (key) => values[key] };
  const applicationName = 'recovery-' + process.pid + '-' + randomUUID();
  const databaseUrl = new URL(env.DATABASE_URL);
  databaseUrl.searchParams.set('application_name', applicationName);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl.href } } });
  const { StorageService } = load('documents/storage.service.js'),
    { AuditService } = load('common/audit.service.js');
  const { DocumentScannerService } = load('documents/document-scanner.service.js');
  const { StorageRecoveryService } = load('storage-recovery/storage-recovery.service.js');
  const { StorageRecoveryAdminService } = load(
    'storage-recovery/storage-recovery-admin.service.js',
  );
  const { DocumentsService } = load('documents/documents.service.js'),
    { ClientsService } = load('clients/clients.service.js');
  const { DocumentSigningService } = load('documents/document-signing.service.js');
  const storage = new StorageService(config),
    audit = new AuditService(),
    scanner = new DocumentScannerService(config);
  const recovery = new StorageRecoveryService(db, storage, audit, config);
  const admin = new StorageRecoveryAdminService(db, recovery, storage, audit, config);
  const docs = new DocumentsService(
    db,
    storage,
    audit,
    config,
    undefined,
    undefined,
    scanner,
    recovery,
  );
  const clients = new ClientsService(db, audit, storage, scanner, recovery);
  const signing = new DocumentSigningService(db, storage, audit, scanner, recovery);
  await db.$connect();
  try {
    await assertOwnedStack(db, env);
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
  await db.$transaction((tx) => recovery.assertFences(tx));
  return {
    db,
    storage,
    audit,
    scanner,
    recovery,
    admin,
    docs,
    clients,
    signing,
    config,
    applicationName,
  };
}

export async function snapshot(r, organizationId) {
  const intents = await r.db.storageUploadIntent.findMany({
    where: { organizationId },
    orderBy: { id: 'asc' },
  });
  const objects = [];
  for (const op of intents)
    objects.push({
      id: op.id,
      bucket: op.bucket,
      key: op.objectKey,
      observation: await r.storage.inspect(op.objectKey, op.bucket),
    });
  return {
    // Explicit projection: NEVER serialize ownerToken, Auth tokens, cookies or signed URLs.
    intents: intents.map((op) => ({
      id: op.id,
      organizationId: op.organizationId,
      purpose: op.purpose,
      bucket: op.bucket,
      key: op.objectKey,
      state: op.state,
      expectedSha256: op.expectedSha256,
      observedSha256: op.observedSha256,
      attempts: op.attempts,
      generation: op.generation,
      legalHold: op.legalHold,
      abandonedAt: op.abandonedAt,
      cleanupStartedAt: op.cleanupStartedAt,
      attachedAt: op.attachedAt,
      leaseUntil: op.leaseUntil,
      lastErrorCode: op.lastErrorCode,
    })),
    objects,
    versions: await r.db.documentVersion.findMany({
      where: { organizationId },
      select: { id: true, documentId: true, storageKey: true, sha256: true, sizeBytes: true },
    }),
    photos: await r.db.client.findMany({
      where: { organizationId },
      select: { id: true, photoStorageKey: true, deletedAt: true },
    }),
    signatures: await r.db.documentSigningRequest.findMany({
      where: { organizationId },
      select: {
        id: true,
        status: true,
        signatureStorageKey: true,
        signatureSha256: true,
        signedDocumentId: true,
        processingGroupId: true,
        processingLeaseUntil: true,
      },
    }),
    incidents: await r.db.storageRecoveryIncident.findMany({
      where: { organizationId },
      select: {
        id: true,
        operationId: true,
        kind: true,
        state: true,
        notificationUndelivered: true,
      },
    }),
    events: await r.db.storageRecoveryEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    }),
    audit: await r.db.auditLog.findMany({
      where: {
        organizationId,
        resource: { in: ['storage_recovery', 'storage_recovery_incident'] },
      },
      select: {
        id: true,
        resource: true,
        resourceId: true,
        action: true,
        after: true,
        metadata: true,
      },
    }),
  };
}
