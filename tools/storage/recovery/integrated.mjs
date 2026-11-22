import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runtime, snapshot } from './runtime.mjs';
import { fixture } from './fixtures.mjs';
import { writerBoundary } from './writer-faults.mjs';
import { independentRecovery } from './independent-process.mjs';
import { transversal } from './transversal.mjs';
import { validateRecoveryEnvironment } from './environment.mjs';

validateRecoveryEnvironment();
const contracts = JSON.parse(readFileSync(new URL('./contracts.json', import.meta.url), 'utf8'));
assert.equal(contracts.length, 58);
assert.equal(new Set(contracts.map((c) => c.id)).size, 58);
const out = resolve(process.env.LIVIO_QA_OUTPUT, 'storage-recovery-stage61.json');
assert.equal(existsSync(out), false, 'Never overwrite recovery evidence');
mkdirSync(resolve(process.env.LIVIO_QA_OUTPUT), { recursive: true });
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  environment: 'DISPOSABLE_REAL_PG_AUTH_STORAGE_CLAMAV_QPDF',
  activation: 'Harness instances only; no hosted configuration',
  cases: contracts.map((c) => ({
    ...c,
    result: 'NOT_EXECUTED',
    observedState: null,
    observedPhysicalEffect: null,
    evidence: null,
  })),
};
const save = () =>
  writeFileSync(
    out,
    JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
  );
save();
const purpose = ['DOCUMENT', 'VERSION', 'PHOTO', 'SIGNATURE', 'SIGNED_PDF'];

async function crash(r, input, row) {
  const child = fork(new URL('./crash-child.mjs', import.meta.url), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced',
  });
  try {
    child.send(input);
    const [message] = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(() => {
        throw new Error('UPLOAD_CHILD_EXITED_BEFORE_BARRIER');
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('UPLOAD_CHILD_TIMEOUT')), 120000).unref(),
      ),
    ]);
    assert.equal(message.barrier, 'PROVIDER_COMPLETED_BEFORE_INTENT_COMMIT');
    const operation = await r.db.storageUploadIntent.findUniqueOrThrow({
      where: { id: message.operationId },
    });
    assert.equal(operation.organizationId, input.actor.organizationId);
    assert.equal(operation.purpose, input.purpose);
    assert.equal(operation.state, 'UPLOADING');
    const physical = await r.storage.inspect(operation.objectKey, operation.bucket);
    assert.equal(physical.status, 'PRESENT');
    assert.equal(physical.sha256, operation.expectedSha256);
    row.beforeKill = { operationId: operation.id, state: operation.state, physical };
    row.crashedPid = child.pid;
    row.barrier = message.barrier;
    row.operationId = message.operationId;
    child.kill('SIGKILL');
    await once(child, 'exit');
    row.actualChildExit = child.signalCode;
    assert.equal(row.actualChildExit, 'SIGKILL');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => {});
    }
  }
}

let r;
try {
  r = await runtime();
  report.databaseRole = await r.db
    .$queryRaw`SELECT current_user::text AS role,current_database()::text AS database`;
  report.migration = await r.db
    .$queryRaw`SELECT version FROM supabase_migrations.schema_migrations WHERE version='20261113100000'`;
  assert.equal(
    report.migration.length,
    1,
    'Actual migration must be applied by disposable stack preparation',
  );
  for (const row of report.cases) {
    try {
      if (
        row.id === 'REC-X18' &&
        process.env.LIVIO_RECOVERY_COORDINATED_RESTORE === 'parent-owned'
      ) {
        row.reason = 'Coordinated restore runs after this owned API and database clients stop';
        save();
        continue;
      }
      if (row.id.startsWith('REC-X')) {
        await transversal(r, row, fixture, independentRecovery);
        save();
        continue;
      }
      const [, writer, boundary] = row.id.split('-'),
        input = await fixture(r, purpose[Number(writer.slice(1)) - 1]);
      row.before = await snapshot(r, input.actor.organizationId);
      if (boundary === 'F05') await crash(r, input, row);
      else {
        const executed = await writerBoundary(r, input, boundary, row);
        if (executed.status === 'NOT_EXECUTED') {
          row.reason = executed.reason;
          save();
          continue;
        }
      }
      row.interrupted = await snapshot(r, input.actor.organizationId);
      // Controlled clock expiry only in OUR synthetic organization. No Storage metadata DML.
      await r.db.storageUploadIntent.updateMany({
        where: { organizationId: input.actor.organizationId },
        data: { dueAt: new Date(0), leaseUntil: new Date(0) },
      });
      await r.db.documentSigningRequest.updateMany({
        where: { organizationId: input.actor.organizationId, status: 'PROCESSING' },
        data: { processingLeaseUntil: new Date(0) },
      });
      const recovered = await independentRecovery(input);
      row.recoveryPid = recovered.pid;
      row.after = recovered.snapshot;
      if (row.crashedPid) assert.notEqual(row.recoveryPid, row.crashedPid);
      for (const version of row.after.versions) {
        const object = row.after.objects.find(
          (o) => o.key === version.storageKey && o.bucket === 'legal-documents',
        );
        assert.equal(object?.observation.status, 'PRESENT');
        assert.equal(object.observation.sha256, version.sha256);
      }
      for (const op of row.after.intents) {
        const object = row.after.objects.find((o) => o.id === op.id);
        if (op.state === 'ABSENT') assert.equal(object.observation.status, 'ABSENT');
        else
          assert.ok(
            [
              'COMPLETE',
              'RETAINED',
              'INCIDENT',
              'RECONCILE_PENDING',
              'COMPENSATION_REQUIRED',
            ].includes(op.state),
            'Unresolved state must be explicit',
          );
      }
      const originalIds = new Set(row.before.versions.map((v) => v.id));
      assert.deepEqual(
        row.after.versions.filter((v) => originalIds.has(v.id)),
        row.before.versions,
      );
      assert.ok(row.after.events.length > 0);
      assert.ok(row.after.audit.length > 0);
      if (boundary === 'F02' || boundary === 'F08')
        assert.ok(
          row.after.intents.some(
            (o) => o.purpose === input.purpose && ['COMPLETE', 'RETAINED'].includes(o.state),
          ),
        );
      else
        assert.ok(
          row.after.intents
            .filter((o) => !row.before.intents.some((b) => b.id === o.id))
            .every((o) => o.state === 'ABSENT'),
          'Recovery must finish compensating newly interrupted objects',
        );
      row.observedState = row.after.intents.map((o) => ({ id: o.id, state: o.state }));
      row.observedPhysicalEffect = row.after.objects;
      row.result = 'PASS';
      row.evidence =
        'before/interrupted/after snapshots + new process PID + trigger events + physical downloads';
    } catch (error) {
      row.result = 'FAIL';
      row.error = { name: error.name, code: error.code ?? null };
    }
    save();
  }
} finally {
  await r?.db.$disconnect();
  save();
}
// A partial matrix is deliberately non-green. Never hide missing contracts.
if (
  report.cases.some(
    (c) =>
      c.result !== 'PASS' &&
      !(c.id === 'REC-X18' && process.env.LIVIO_RECOVERY_COORDINATED_RESTORE === 'parent-owned'),
  )
)
  process.exitCode = 1;
