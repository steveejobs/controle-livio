import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { rawRecord, denialKind, financialTables } from './financial-write-matrix.mjs';

test('zero-row success, invalid JWT, FK, malformed input and RLS are distinct from SQL privilege denial', () => {
  assert.equal(denialKind(200, []), 'WRITE_ACCEPTED');
  assert.equal(denialKind(204, {}), 'WRITE_ACCEPTED');
  assert.equal(denialKind(401, { code: 'PGRST301' }), 'AUTHENTICATION_FAILURE');
  for (const code of ['23503', '23502', 'PGRST100'])
    assert.equal(denialKind(400, { code }), 'HARNESS_OR_DOMAIN_FAILURE');
  assert.equal(
    denialKind(403, {
      code: '42501',
      message: 'new row violates row-level security policy for table x',
    }),
    'RLS_DENIED',
  );
  assert.equal(
    denialKind(403, { code: '42501', message: 'permission denied for table payments' }),
    'PRIVILEGE_DENIED',
  );
  assert.equal(
    denialKind(401, { code: '42501', message: 'permission denied for table payments' }),
    'PRIVILEGE_DENIED',
  );
});

test('raw payload retains monetary strings, dates, nulls and JSON while excluding relations', () => {
  const require = createRequire(import.meta.url);
  const { Prisma } = require('@prisma/client');
  const model = Prisma.dmmf.datamodel.models.find((m) => m.dbName === 'payments');
  const record = rawRecord(model, {
    id: 'synthetic',
    organizationId: 'organization',
    amount: new Prisma.Decimal('70.00'),
    paidAt: new Date('2026-11-10T12:00:00Z'),
    metadata: { note: 'synthetic' },
    externalId: null,
    allocations: [],
  });
  assert.equal(record.amount, '70');
  assert.equal(record.organization_id, 'organization');
  assert.equal(record.paid_at, '2026-11-10T12:00:00.000Z');
  assert.equal(record.external_id, null);
  assert.deepEqual(record.metadata, { note: 'synthetic' });
  assert.ok(!('allocations' in record));
});

test('migration is atomic, guards only writes, and references existing versioned tables', () => {
  const sql = readFileSync(
    new URL(
      '../../supabase/migrations/20261111120000_financial_api_write_boundary.sql',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(sql, /^BEGIN;/);
  assert.equal(sql.split('$security$').length, 3);
  assert.equal(sql.split('$evidence$').length, 3);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /\bFOR\s+(ALL|SELECT)\b|\b(?:DROP|TRUNCATE)\b/i);
  assert.match(sql, /pg_has_role\(r,oid,'SET'\)/);
  assert.match(sql, /has_any_column_privilege/);
  const require = createRequire(import.meta.url);
  const { Prisma } = require('@prisma/client');
  for (const table of financialTables) {
    assert.ok(Prisma.dmmf.datamodel.models.some((m) => m.dbName === table));
    assert.ok(sql.includes("'" + table + "'"));
  }
});
