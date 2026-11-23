import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

let cached;
// Loading this module never reads files or imports the ORM. Guards can execute
// before npm ci. Metadata is read only when an actual QA caller requests it.
export function loadPrismaDatamodel() {
  if (cached) return cached;
  const schema = readFileSync(
    new URL('../../packages/db/prisma/schema.prisma', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  const generated = JSON.parse(
    readFileSync(
      new URL('../../packages/db/prisma/generated/qa-model/model.json', import.meta.url),
      'utf8',
    ),
  );
  if (generated.schemaSha256 !== createHash('sha256').update(schema).digest('hex'))
    throw new Error('QA model metadata is stale; run npm run db:generate');
  if (!Array.isArray(generated.datamodel?.models) || !Array.isArray(generated.datamodel?.enums))
    throw new Error('QA model metadata is invalid; regenerate it');
  cached = generated.datamodel;
  return cached;
}
