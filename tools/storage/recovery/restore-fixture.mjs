import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fixture, invokeWriter } from './fixtures.mjs';
import { snapshot } from './runtime.mjs';

export async function restoreFixture(r) {
  const input = await fixture(r, 'SIGNED_PDF', { restoreCredentials: true });
  await invokeWriter(r, { ...input, purpose: 'VERSION' });
  await invokeWriter(r, { ...input, purpose: 'PHOTO', bytes: input.signature, mime: 'image/png' });
  await invokeWriter(r, input);
  const bytes = Buffer.from(input.bytes, 'base64'),
    hash = createHash('sha256').update(bytes).digest('hex');
  const planned = async (label) => {
    const id = randomUUID();
    return r.recovery.plan({
      organizationId: input.actor.organizationId,
      actorUserId: input.actor.userId,
      purpose: 'DOCUMENT',
      bucket: 'legal-documents',
      key: `organizations/${input.actor.organizationId}/documents/${id}/${label}.pdf`,
      resourceType: 'document',
      resourceId: id,
      expectedSha256: hash,
      idempotencyKey: `restore-${label}-${id}`,
    });
  };
  const pending = await planned('compensation');
  await r.recovery.store(pending, bytes, 'application/pdf', () =>
    r.scanner.assertClean(bytes, 'application/pdf'),
  );
  const remove = r.storage.remove.bind(r.storage);
  r.storage.remove = async () => {
    throw Object.assign(new Error('SYNTHETIC_RESTORE_PROVIDER_FAILURE'), { code: 'ECONNRESET' });
  };
  try {
    await r.recovery.compensate(pending).catch(() => {});
  } finally {
    r.storage.remove = remove;
  }
  const held = await planned('retained');
  await r.recovery.store(held, bytes, 'application/pdf', () =>
    r.scanner.assertClean(bytes, 'application/pdf'),
  );
  await r.db.$transaction(async (tx) => {
    const op = await r.recovery.lock(tx, held.id);
    await r.recovery.transition(tx, op, 'COMPENSATION_REQUIRED', {
      legalHold: true,
      cleanupStartedAt: new Date(),
      leaseUntil: new Date(0),
    });
  });
  await r.recovery.recoverOne(held.id, held);
  const absent = await planned('absent');
  await r.recovery.compensate(absent);
  const awaiting = await planned('awaiting-upload');
  const damaged = await planned('incident');
  await r.recovery.store(damaged, bytes, 'application/pdf', () =>
    r.scanner.assertClean(bytes, 'application/pdf'),
  );
  // Reach an actual exhausted recovery generation, preserving all eight attempts.
  const removal = r.storage.remove.bind(r.storage);
  r.storage.remove = async () => {
    throw Object.assign(new Error('SYNTHETIC_RESTORE_PROVIDER_FAILURE'), { code: 'ECONNRESET' });
  };
  try {
    await r.recovery.compensate(damaged).catch(() => {});
    for (let attempt = 1; attempt < 8; attempt++) {
      await r.db.storageUploadIntent.update({
        where: { id: damaged.id },
        data: { leaseUntil: new Date(0), dueAt: new Date(0) },
      });
      await r.recovery.recoverOne(damaged.id);
    }
  } finally {
    r.storage.remove = removal;
  }
  const exhausted = await r.db.storageUploadIntent.findUniqueOrThrow({ where: { id: damaged.id } });
  assert.equal(exhausted.state, 'INCIDENT');
  assert.equal(exhausted.attempts, 8);
  // An actual interrupted signing process, with its first object already stored.
  const interrupted = await fixture(r, 'SIGNATURE');
  const child = fork(new URL('./crash-child.mjs', import.meta.url), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced',
  });
  let crash;
  try {
    child.send(interrupted);
    const [message] = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => {
        throw new Error('RESTORE_CHILD_EXITED');
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('RESTORE_CRASH_TIMEOUT')), 120000).unref(),
      ),
    ]);
    assert.equal(message.barrier, 'PROVIDER_COMPLETED_BEFORE_INTENT_COMMIT');
    const op = await r.db.storageUploadIntent.findUniqueOrThrow({
      where: { id: message.operationId },
    });
    assert.equal((await r.storage.inspect(op.objectKey, op.bucket)).status, 'PRESENT');
    child.kill('SIGKILL');
    await once(child, 'exit');
    assert.equal(child.signalCode, 'SIGKILL');
    crash = { pid: child.pid, operationId: op.id, barrier: message.barrier };
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => {});
    }
  }
  // REC-C01 remains the real preserved financial harness fixture, not a fake receipt.
  const receipt = await r.db.paymentReceipt.findFirst({
    select: { id: true, organizationId: true, documentId: true },
  });
  assert.ok(receipt, 'Financial rehearsal must have persisted a legitimate receipt');
  const receiptVersions = await r.db.documentVersion.findMany({
    where: { documentId: receipt.documentId },
    select: { storageKey: true, sha256: true },
  });
  assert.ok(receiptVersions.length);
  for (const v of receiptVersions) {
    const physical = await r.storage.inspect(v.storageKey, 'legal-documents');
    assert.equal(physical.status, 'PRESENT');
    assert.equal(physical.sha256, v.sha256);
  }
  const organizations = [
    input.actor.organizationId,
    interrupted.actor.organizationId,
    receipt.organizationId,
  ];
  const before = [];
  for (const organization of new Set(organizations)) before.push(await snapshot(r, organization));
  assert.ok(before[0].versions.length >= 3);
  assert.ok(before[0].signatures.some((s) => s.status === 'SIGNED'));
  assert.ok(before[1].signatures.some((s) => s.status === 'PROCESSING'));
  assert.ok(before[0].incidents.length && before[0].events.length);
  return {
    input,
    interrupted,
    organizations: [...new Set(organizations)],
    before,
    crash,
    receipt,
    receiptVersions,
    pending: pending.id,
    held: held.id,
    absent: absent.id,
    awaiting: awaiting.id,
  };
}
