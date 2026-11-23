import internals from '@prisma/internals';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = fileURLToPath(new URL('../../packages/db/prisma/schema.prisma', import.meta.url));
const output = fileURLToPath(
  new URL('../../packages/db/prisma/generated/qa-model', import.meta.url),
);

// CLI/QA only, pinned to the exact Prisma version. No runtime API monkey patch
// and no database connection: DMMF comes solely from the canonical schema.
const source = readFileSync(schema, 'utf8').replaceAll('\r\n', '\n');
const dmmf = await internals.getDMMF({ datamodel: source });
mkdirSync(output, { recursive: true });
writeFileSync(
  resolve(output, 'model.json'),
  JSON.stringify({
    schemaSha256: createHash('sha256').update(source).digest('hex'),
    datamodel: dmmf.datamodel,
  }),
);
