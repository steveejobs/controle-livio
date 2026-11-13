import { runtime } from './runtime.mjs';
import assert from 'node:assert/strict';
let finished = false;
process.once('disconnect', () => {
  if (!finished) process.exit(2);
});

// IPC carries only ephemeral synthetic fixture context. No request/header dump.
// Parent kills ONLY this child PID after a verified upload or committed-delete barrier.
process.once('message', async (input) => {
  let r;
  try {
    r = await runtime();
    if (input.recoveryOperation) {
      const op = await r.db.storageUploadIntent.findUniqueOrThrow({
        where: { id: input.recoveryOperation.id },
      });
      assert.equal(op.organizationId, input.recoveryOperation.organizationId);
      r.storage.remove = async () => {
        process.send({ barrier: 'DELETING_COMMITTED_BEFORE_PROVIDER', operationId: op.id });
        await new Promise(() => {});
      };
      await r.recovery.recoverOne(op.id);
      throw new Error('RECOVERY_FINISHED_BEFORE_CRASH_BARRIER');
    }
    const original = r.storage.upload.bind(r.storage);
    r.storage.upload = async (key, bytes, mime, bucket) => {
      await original(key, bytes, mime, bucket);
      const op = await r.db.storageUploadIntent.findUniqueOrThrow({
        where: { bucket_objectKey: { bucket: bucket ?? 'legal-documents', objectKey: key } },
      });
      if (op.purpose === input.purpose) {
        process.send({ barrier: 'PROVIDER_COMPLETED_BEFORE_INTENT_COMMIT', operationId: op.id });
        await new Promise(() => {});
      }
    };
    const bytes = Buffer.from(input.bytes, 'base64'),
      file = {
        buffer: bytes,
        size: bytes.length,
        mimetype: input.mime,
        originalname: 'synthetic-recovery-test.' + (input.mime === 'image/png' ? 'png' : 'pdf'),
      };
    if (input.purpose === 'DOCUMENT')
      await r.docs.create(
        input.actor,
        { title: 'SYNTHETIC RECOVERY TEST', clientId: input.clientId, visibility: 'INTERNAL' },
        file,
      );
    else if (input.purpose === 'VERSION')
      await r.docs.addVersion(input.actor, input.documentId, file);
    else if (input.purpose === 'PHOTO')
      await r.clients.uploadPhoto(input.actor, input.clientId, file);
    else
      await r.signing.sign(input.token, {
        signerName: 'SYNTHETIC RECOVERY TEST',
        consent: true,
        signature: 'data:image/png;base64,' + input.signature,
      });
    process.send({ unexpectedCompletion: true });
  } catch (error) {
    process.send({ error: { name: error.name, code: error.code ?? null } });
  } finally {
    await r?.db.$disconnect();
    finished = true;
    process.disconnect();
  }
});
