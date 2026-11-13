import assert from 'node:assert/strict';
import { invokeWriter } from './fixtures.mjs';
import { delayedProvider } from './delayed-provider.mjs';

export async function lateWrite(r, input, evidence) {
  const nativeFetch = globalThis.fetch,
    store = r.recovery.store.bind(r.recovery);
  let barrier, operation, writerError;
  r.recovery.store = async (ticket, ...args) => {
    const op = await r.db.storageUploadIntent.findUniqueOrThrow({ where: { id: ticket.id } });
    if (op.purpose === input.purpose) {
      assert.equal(barrier, undefined, 'Exactly one delayed upload per contract');
      operation = op;
      // supabase-js encodes each segment; match the actual SDK URL, not a new upload.
      const path = `/storage/v1/object/${op.bucket}/${op.objectKey.split('/').map(encodeURIComponent).join('/')}`;
      const target = new URL(path, process.env.SUPABASE_URL).href;
      barrier = await delayedProvider(target, { fetchImpl: nativeFetch });
      globalThis.fetch = (request, options) => {
        const url =
          typeof request === 'string' || request instanceof URL ? String(request) : request.url;
        const method = options?.method ?? request.method ?? 'GET';
        return url === target && method.toUpperCase() === 'POST'
          ? barrier.request(request, options)
          : nativeFetch(request, options);
      };
    }
    return store(ticket, ...args);
  };
  try {
    try {
      await invokeWriter(r, input);
    } catch (error) {
      writerError = error;
    }
    assert.ok(writerError, 'A timeout must not report writer success');
    assert.ok(barrier, 'Real target upload was not reached');
    evidence.transport = await barrier.received;
    evidence.timeoutObservedAt = Date.now();
    const pending = await r.db.storageUploadIntent.findUniqueOrThrow({
      where: { id: operation.id },
    });
    assert.equal(pending.state, 'UPLOADING');
    assert.ok(pending.abandonedAt);
    assert.equal(pending.cleanupStartedAt, null);
    assert.ok(pending.leaseUntil > new Date());
    assert.equal((await r.storage.inspect(operation.objectKey, operation.bucket)).status, 'ABSENT');
    evidence.intentAtTimeout = {
      id: pending.id,
      organizationId: pending.organizationId,
      bucket: pending.bucket,
      key: pending.objectKey,
      purpose: pending.purpose,
      expectedSha256: pending.expectedSha256,
      state: pending.state,
      abandonedAt: pending.abandonedAt,
      leaseUntil: pending.leaseUntil,
    };
    const metadata = () =>
      r.db
        .$queryRaw`SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=${pending.bucket} AND name=${pending.objectKey}) AS present`;
    evidence.metadataBefore = await metadata();
    assert.equal(evidence.metadataBefore[0].present, false);
    barrier.release();
    evidence.provider = await barrier.result;
    assert.ok(
      evidence.provider.status >= 200 && evidence.provider.status < 300,
      'Original request must really reach Storage',
    );
    assert.ok(evidence.provider.providerCompletedAt > evidence.timeoutObservedAt);
    evidence.firstVisibleAt = Date.now();
    evidence.physicalAfterTimeout = await r.storage.inspect(operation.objectKey, operation.bucket);
    assert.equal(evidence.physicalAfterTimeout.status, 'PRESENT');
    assert.equal(evidence.physicalAfterTimeout.sha256, pending.expectedSha256);
    evidence.metadataAfter = await metadata();
    assert.equal(evidence.metadataAfter[0].present, true);
    await assert.rejects(
      r.db.$transaction((tx) =>
        r.recovery.lockForAttachment(tx, {
          id: pending.id,
          organizationId: pending.organizationId,
          ownerToken: pending.ownerToken,
        }),
      ),
      'Abandoned upload cannot be attached',
    );
    evidence.writerOutcome = { name: writerError.name, code: writerError.code ?? null };
    evidence.injectedBoundary = 'F07_REAL_BUFFERED_HTTP_AFTER_CLIENT_TIMEOUT';
    return { status: 'EXECUTED' };
  } finally {
    globalThis.fetch = nativeFetch;
    r.recovery.store = store;
    await barrier?.close();
  }
}
