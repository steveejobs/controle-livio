import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { runtime, snapshot } from './runtime.mjs';
import { writerBoundary } from './writer-faults.mjs';
import { independentRecovery } from './independent-process.mjs';

export async function measuredRecovery(r, observer, operationId, evidence) {
  const transaction = r.db.$transaction.bind(r.db),
    inspect = r.storage.inspect.bind(r.storage);
  const timings = [],
    samples = [];
  r.db.$transaction = (fn, options) => {
    if (typeof fn !== 'function') return transaction(fn, options);
    const requested = performance.now();
    return transaction(async (tx) => {
      const acquired = performance.now();
      try {
        return await fn(tx);
      } finally {
        timings.push({ waitMs: acquired - requested, heldMs: performance.now() - acquired });
      }
    }, options);
  };
  r.storage.inspect = async (...args) => {
    // A controlled provider latency window, followed by the real HTTP GET.
    // Read-only independent PG observations must show no open worker xact.
    for (let i = 0; i < 3; i++) {
      const rows = await observer.db
        .$queryRaw`SELECT pid,state,xact_start,wait_event_type,wait_event FROM pg_stat_activity WHERE application_name=${r.applicationName}`;
      assert.ok(rows.length);
      assert.ok(
        rows.every((row) => row.xact_start === null),
        'External Storage I/O must not hold a PostgreSQL transaction',
      );
      samples.push(
        rows.map((row) => ({
          pid: row.pid,
          state: row.state,
          openTransaction: row.xact_start !== null,
          waitEvent: row.wait_event,
        })),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return inspect(...args);
  };
  try {
    return await r.recovery.recoverOne(operationId);
  } finally {
    r.db.$transaction = transaction;
    r.storage.inspect = inspect;
    evidence.transactions = timings;
    evidence.externalIoSamples = samples;
  }
}

export async function interruptionRecovery(factory, evidence) {
  evidence.interruptions = [];
  for (const mode of ['WORKER_CRASH', 'EXPIRED_CLAIM', 'SQL_CONNECTION_LOST']) {
    const worker = await runtime(),
      observer = await runtime();
    let child;
    try {
      const input = await factory(worker, 'DOCUMENT'),
        org = input.actor.organizationId;
      const before = await snapshot(worker, org);
      await writerBoundary(worker, input, 'F04', {});
      const op = await observer.db.storageUploadIntent.findFirstOrThrow({
        where: { organizationId: org, state: 'RECONCILE_PENDING' },
      });
      const expire = () =>
        observer.db.storageUploadIntent.update({
          where: { id: op.id },
          data: { leaseUntil: new Date(0), dueAt: new Date(0) },
        });
      await expire();
      const item = { mode, operationId: op.id, result: 'NOT_EXECUTED' };
      evidence.interruptions.push(item);
      if (mode === 'WORKER_CRASH') {
        child = fork(new URL('./crash-child.mjs', import.meta.url), [], {
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          serialization: 'advanced',
        });
        child.send({ recoveryOperation: { id: op.id, organizationId: org } });
        const [message] = await Promise.race([
          once(child, 'message'),
          once(child, 'exit').then(() => {
            throw new Error('WORKER_EXITED_BEFORE_BARRIER');
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('WORKER_CRASH_BARRIER_TIMEOUT')), 120000).unref(),
          ),
        ]);
        assert.equal(message.barrier, 'DELETING_COMMITTED_BEFORE_PROVIDER');
        assert.equal(
          (await observer.db.storageUploadIntent.findUniqueOrThrow({ where: { id: op.id } })).state,
          'DELETING',
        );
        assert.equal((await observer.storage.inspect(op.objectKey, op.bucket)).status, 'PRESENT');
        item.crashedPid = child.pid;
        child.kill('SIGKILL');
        await once(child, 'exit');
        assert.equal(child.signalCode, 'SIGKILL');
        item.signal = child.signalCode;
      } else {
        const inspect = worker.storage.inspect.bind(worker.storage);
        let paused, release;
        const reached = new Promise((r) => (paused = r)),
          gate = new Promise((r) => (release = r));
        worker.storage.inspect = async (...args) => {
          paused();
          await gate;
          return inspect(...args);
        };
        const running = worker.recovery.recoverOne(op.id).then(
          (value) => ({ value }),
          (error) => ({ error: { name: error.name, code: error.code ?? null } }),
        );
        try {
          await Promise.race([
            reached,
            running.then(() => {
              throw new Error('WORKER_DID_NOT_REACH_IO');
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('WORKER_IO_BARRIER_TIMEOUT')), 30000).unref(),
            ),
          ]);
          if (mode === 'SQL_CONNECTION_LOST') {
            const sessions = await observer.db
              .$queryRaw`SELECT pid,pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name=${worker.applicationName} AND pid<>pg_backend_pid()`;
            assert.ok(sessions.length);
            assert.ok(sessions.every((s) => s.terminated));
            item.terminatedOwnSessions = sessions;
          } else {
            await expire();
            item.successor = await observer.recovery.recoverOne(op.id);
            assert.equal(item.successor.status, 'ABSENT');
          }
        } finally {
          release();
        }
        item.oldWorker = await running;
        if (mode === 'EXPIRED_CLAIM') assert.equal(item.oldWorker.value?.status, 'SKIPPED');
        worker.storage.inspect = inspect;
      }
      await expire();
      const recovered = await independentRecovery(input);
      item.recoveryPid = recovered.pid;
      if (item.crashedPid) assert.notEqual(item.recoveryPid, item.crashedPid);
      assert.equal(
        (await observer.db.storageUploadIntent.findUniqueOrThrow({ where: { id: op.id } })).state,
        'ABSENT',
      );
      assert.equal((await observer.storage.inspect(op.objectKey, op.bucket)).status, 'ABSENT');
      const after = await snapshot(observer, org);
      assert.deepEqual(after.versions, before.versions);
      item.after = after;
      item.result = 'PASS';
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await once(child, 'exit').catch(() => {});
      }
      await worker.db.$disconnect();
      await observer.db.$disconnect();
    }
  }
}
