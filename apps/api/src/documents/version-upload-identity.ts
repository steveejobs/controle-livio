import { createHash } from 'node:crypto';

// An immutable object key identifies one upload operation. Recovery retries reuse
// that key/ticket; a new addVersion request remains a distinct operation.
// Keep valid legacy identities addressable without rewriting persisted intents.
export function versionUploadIdentity(
  organizationId: string,
  documentId: string,
  objectKey: string,
) {
  const legacy = 'VERSION:' + objectKey;
  if (legacy.length <= 160) return legacy;
  return (
    'VERSION:SHA256:' +
    createHash('sha256')
      .update(JSON.stringify(['VERSION', organizationId, documentId, objectKey]), 'utf8')
      .digest('hex')
  );
}
