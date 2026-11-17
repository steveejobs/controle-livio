import assert from 'node:assert/strict';
import { invokeWriter } from './fixtures.mjs';
import { lateWrite } from './late-write.mjs';
import { runtime } from './runtime.mjs';

// Inject only into this harness instance, never via a product env switch/RPC.
export async function writerBoundary(r, input, boundary, evidence) {
  const upload = r.storage.upload.bind(r.storage),
    remove = r.storage.remove.bind(r.storage),
    store = r.recovery.store.bind(r.recovery);
  const transaction = r.db.$transaction.bind(r.db),
    complete = r.recovery.complete.bind(r.recovery);
  let injected = false,
    removed = false,
    lockProbe;
  const fail = () => {
    injected = true;
    throw Object.assign(new Error('INJECTED_RECOVERY_BOUNDARY'), {
      code: 'INJECTED_RECOVERY_BOUNDARY',
    });
  };
  if (boundary === 'F07') return lateWrite(r, input, evidence);
  r.recovery.store = async (ticket, ...args) => {
    const op = await r.db.storageUploadIntent.findUniqueOrThrow({ where: { id: ticket.id } });
    if (boundary === 'F01' && op.purpose === input.purpose) fail();
    return store(ticket, ...args);
  };
  if (boundary === 'F02')
    r.storage.upload = async (key, bytes, mime, bucket) => {
      await upload(key, bytes, mime, bucket);
      const op = await r.db.storageUploadIntent.findUniqueOrThrow({
        where: { bucket_objectKey: { bucket: bucket ?? 'legal-documents', objectKey: key } },
      });
      if (op.purpose === input.purpose) {
        injected = true;
        throw Object.assign(new Error('INJECTED_PROVIDER_TIMEOUT_AFTER_WRITE'), {
          code: 'ETIMEDOUT',
        });
      }
    };
  if (['F03', 'F04', 'F06'].includes(boundary))
    r.db.$transaction = (fn, options) => {
      if (typeof fn !== 'function') return transaction(fn, options);
      return transaction(async (tx) => {
        const proxy = new Proxy(tx, {
          get(target, model) {
            if (['document', 'documentVersion', 'client', 'documentSigningRequest'].includes(model))
              return new Proxy(target[model], {
                get(table, method) {
                  const value = table[method];
                  if (typeof value !== 'function') return value;
                  return async (args) => {
                    const result = await value.call(table, args);
                    if (
                      !injected &&
                      ((model === 'document' && method === 'create') ||
                        (model === 'documentVersion' && method === 'create') ||
                        (model === 'client' &&
                          method === 'updateMany' &&
                          args.data.photoStorageKey) ||
                        (model === 'documentSigningRequest' &&
                          method === 'updateMany' &&
                          args.data.status === 'SIGNED'))
                    )
                      fail();
                    return result;
                  };
                },
              });
            const value = Reflect.get(target, model);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const result = await fn(proxy);
        if (boundary === 'F06' && removed && result?.status === 'ABSENT') {
          removed = false;
          fail();
        }
        return result;
      }, options);
    };
  if (boundary === 'F04')
    r.storage.remove = async () => {
      throw Object.assign(new Error('INJECTED_PROVIDER_UNAVAILABLE'), { code: 'ECONNRESET' });
    };
  if (boundary === 'F06')
    r.storage.remove = async (...args) => {
      await remove(...args);
      removed = true;
    };
  if (boundary === 'F08')
    r.recovery.complete = async (tx, ticket) => {
      const operation = await tx.storageUploadIntent.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      if (operation.purpose === input.purpose) {
        const independent = await runtime();
        try {
          lockProbe = await independent.recovery.recoverOne(ticket.id, ticket);
          assert.equal(
            lockProbe.status,
            'SKIPPED',
            'Concurrent cleanup must not claim an attaching intent',
          );
        } finally {
          await independent.db.$disconnect();
        }
      }
      return complete(tx, ticket);
    };
  try {
    try {
      await invokeWriter(r, input);
      evidence.writerOutcome = 'SUCCESS';
    } catch (error) {
      evidence.writerOutcome = { name: error.name, code: error.code ?? null };
    }
    if (boundary === 'F08') assert.equal(lockProbe?.status, 'SKIPPED');
    else assert.equal(injected, true, 'The claimed fault boundary was not reached');
    evidence.injectedBoundary = boundary;
    evidence.lockProbe = lockProbe;
    return { status: 'EXECUTED' };
  } finally {
    r.storage.upload = upload;
    r.storage.remove = remove;
    r.recovery.store = store;
    r.db.$transaction = transaction;
    r.recovery.complete = complete;
  }
}
