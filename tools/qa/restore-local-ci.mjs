import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const excludedSchedulerSchemas = new Set(['cron', 'net']);
const tocReferencesExcludedSchema = (line) => {
  const entry = line.match(/^\s*\d+;\s+\d+\s+\d+\s+(.+)$/)?.[1];
  if (!entry) return false;
  if (/\b(?:cron|net)\./i.test(entry)) return true;

  const object = entry.match(
    /^(?:(?:ACL|COMMENT|SECURITY LABEL)\s+-\s+)?(?:SCHEMA(?:\s+-)?|TABLE DATA|TABLE|SEQUENCE SET|SEQUENCE|VIEW|MATERIALIZED VIEW|FOREIGN TABLE|FUNCTION|PROCEDURE|AGGREGATE|TYPE|DOMAIN|POLICY|TRIGGER|RULE|DEFAULT ACL(?:\s+-\s+SCHEMA)?)\s+(\S+)/,
  );
  return object ? excludedSchedulerSchemas.has(object[1].toLowerCase()) : false;
};
const isExcludedSchedulerTocEntry = (line) =>
  !line.trimStart().startsWith(';') &&
  (/\b(?:pg_cron|pg_net)\b/.test(line) || tocReferencesExcludedSchema(line));
const filterRestoreToc = (entries) => entries.filter((line) => !isExcludedSchedulerTocEntry(line));

// Exercise the TOC parser without Docker; this does not perform a restore.
assert.equal(
  tocReferencesExcludedSchema('1233; 2615 2200 SCHEMA - cron postgres'),
  true,
  'Scheduler schema entries must be excluded from the restore list',
);
assert.equal(
  tocReferencesExcludedSchema('1233; 0 0 ACL - SCHEMA cron postgres'),
  true,
  'Scheduler schema ACL entries must be excluded from the restore list',
);
assert.equal(
  tocReferencesExcludedSchema('1234; 0 0 ACL - FUNCTION cron alter_job(bigint) postgres'),
  true,
  'Scheduler function ACL entries must be excluded from the restore list',
);
assert.equal(
  tocReferencesExcludedSchema('1234; 0 0 ACL - FUNCTION net some_job() postgres'),
  true,
  'Network extension function ACL entries must be excluded from the restore list',
);
assert.equal(
  tocReferencesExcludedSchema('1234; 0 0 DEFAULT ACL - SCHEMA cron postgres'),
  true,
  'Scheduler default privilege entries must be excluded from the restore list',
);
assert.equal(
  tocReferencesExcludedSchema('1235; 0 0 ACL - FUNCTION public unrelated() postgres'),
  false,
  'Public function ACL entries must remain in the restore list',
);
const tocFixture = [
  '1233; 2615 2200 SCHEMA - cron postgres',
  '1234; 0 0 ACL - FUNCTION cron alter_job(bigint) postgres',
  '1235; 0 0 ACL - SCHEMA net postgres',
  '1236; 0 0 COMMENT - EXTENSION pg_cron postgres',
  '1237; 2615 2200 SCHEMA - public supabase_admin',
  '1238; 0 0 ACL - TABLE public clients supabase_admin',
  '1239; 0 0 ACL - FUNCTION public unrelated() postgres',
];
const filteredTocFixture = filterRestoreToc(tocFixture);
assert.deepEqual(
  filteredTocFixture,
  tocFixture.slice(4),
  'Public schemas and ACLs must be retained',
);
const residualFixtureEntries = filteredTocFixture.filter(isExcludedSchedulerTocEntry);
assert.deepEqual(
  residualFixtureEntries,
  [],
  'Filtered TOC must contain no excluded scheduler entries',
);
if (process.argv.includes('--check-toc-filter')) {
  console.log('Restore TOC filter fixtures passed; no database or backup was accessed.');
  process.exit(0);
}

// No connection string is accepted: this tool can address only the disposable CI container.
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Linux') {
  throw new Error('Restore rehearsal requires the disposable Linux GitHub runner');
}
const container = 'supabase_db_livio-legal-crm';
const suffix = randomBytes(8).toString('hex');
const target = `livio_restore_${suffix}`;
const archive = `/tmp/${target}.dump`;
const restoreList = `/tmp/${target}.list`;
const run = (...args) =>
  execFileSync('docker', ['exec', container, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
const sql = (database, query) =>
  run('psql', '-U', 'supabase_admin', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query);
const started = Date.now();
// Scheduler extensions are tied to the source database; do not activate external jobs in a restore.
run('pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '-Fc', '-f', archive);
const sourceToc = run('pg_restore', '-l', archive).split('\n');
const excludedTocEntries = sourceToc.filter(isExcludedSchedulerTocEntry);
const toc = filterRestoreToc(sourceToc).join('\n');
const residualSchedulerEntries = toc.split('\n').filter(isExcludedSchedulerTocEntry);
if (residualSchedulerEntries.length > 0)
  throw new Error(
    `Restore list still contains excluded scheduler schemas/extensions:\n${residualSchedulerEntries.join('\n')}`,
  );
execFileSync('docker', ['exec', '-i', container, 'tee', restoreList], {
  input: toc,
  stdio: ['pipe', 'ignore', 'pipe'],
});
// createdb fails if the randomly named destination exists. Never clean or overwrite a database.
run('createdb', '-U', 'supabase_admin', '-T', 'template0', target);
// PostgreSQL may omit the built-in public schema from the archive. Preserve it in that case.
if (/\bSCHEMA - public\b/.test(toc)) {
  sql(target, 'ALTER SCHEMA public RENAME TO restore_bootstrap_empty');
}
run(
  'pg_restore',
  '-U',
  'supabase_admin',
  '-d',
  target,
  '--exit-on-error',
  '--use-list',
  restoreList,
  archive,
);
assert.equal(
  sql(target, "SELECT count(*)::text FROM pg_namespace WHERE nspname IN ('cron', 'net')"),
  '0',
  'Scheduler schemas must not be present in the isolated restore target',
);
const tables = sql(
  'postgres',
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
)
  .split('\n')
  .filter(Boolean);
assert.deepEqual(
  sql(target, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
    .split('\n')
    .filter(Boolean),
  tables,
  'Recovered public table set differs',
);
for (const table of tables) {
  const quoted = '"' + table.replaceAll('"', '""') + '"';
  const query = `SELECT count(*)::text || ':' || md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), '')) FROM public.${quoted} t`;
  assert.equal(sql(target, query), sql('postgres', query), `Recovered data differs: ${table}`);
}

const sequenceSnapshot = (database) =>
  sql(
    database,
    `SELECT COALESCE(string_agg(
      format('%I.%I:%s:%s:%s:%s:%s:%s:%s', schemaname, sequencename, data_type,
        start_value, min_value, max_value, increment_by, cycle, COALESCE(last_value::text, 'NULL')),
      E'\\n' ORDER BY schemaname, sequencename), '')
    FROM pg_sequences WHERE schemaname = 'public'`,
  );
assert.equal(sequenceSnapshot(target), sequenceSnapshot('postgres'), 'Recovered sequences differ');

const financialSnapshot = (database) =>
  sql(
    database,
    `SELECT json_build_object(
      'receivables', json_build_object('count', (SELECT count(*) FROM public.receivables), 'amount', (SELECT COALESCE(sum(original_amount), 0)::text FROM public.receivables)),
      'installments', json_build_object('count', (SELECT count(*) FROM public.receivable_installments), 'amount', (SELECT COALESCE(sum(amount), 0)::text FROM public.receivable_installments)),
      'payments', json_build_object('count', (SELECT count(*) FROM public.payments), 'amount', (SELECT COALESCE(sum(amount), 0)::text FROM public.payments)),
      'allocations', json_build_object('count', (SELECT count(*) FROM public.payment_allocations), 'amount', (SELECT COALESCE(sum(amount), 0)::text FROM public.payment_allocations)),
      'expenses', json_build_object('count', (SELECT count(*) FROM public.expenses), 'amount', (SELECT COALESCE(sum(amount), 0)::text FROM public.expenses))
    )::text`,
  );
const financials = financialSnapshot('postgres');
assert.equal(financialSnapshot(target), financials, 'Recovered financial totals differ');
const recoveredFinancials = JSON.parse(financials);
assert.deepEqual(
  recoveredFinancials.receivables,
  { count: 2, amount: '2400.00' },
  'Synthetic restore fixture must contain both known receivables and their exact total',
);

const grantSnapshot = (database) =>
  sql(
    database,
    `SELECT COALESCE(string_agg(entry, E'\\n' ORDER BY entry), '') FROM (
      SELECT 'SCHEMA:' || n.nspname || ':' || x.privilege_type || ':' ||
        CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END || ':' || x.is_grantable::text AS entry
      FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) x
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'RELATION:' || n.nspname || '.' || c.relname || ':' || x.privilege_type || ':' ||
        CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END || ':' || x.is_grantable::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(
          c.relacl,
          acldefault(CASE WHEN c.relkind = 'S' THEN 'S' ELSE 'r' END, c.relowner)
        )) x
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
      UNION ALL
      SELECT 'COLUMN:' || n.nspname || '.' || c.relname || '.' || a.attname || ':' || x.privilege_type || ':' ||
        CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END || ':' || x.is_grantable::text
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(a.attacl, '{}'::aclitem[])) x
      WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'ROUTINE:' || n.nspname || '.' || p.oid::regprocedure::text || ':' || x.privilege_type || ':' ||
        CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END || ':' || x.is_grantable::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'TYPE:' || n.nspname || '.' || t.typname || ':' || x.privilege_type || ':' ||
        CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END || ':' || x.is_grantable::text
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(t.typacl, acldefault('T', t.typowner))) x
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'DEFAULT:' || n.nspname || ':' || pg_get_userbyid(d.defaclrole) || ':' || d.defaclobjtype || ':' ||
        x.privilege_type || ':' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END || ':' || x.is_grantable::text
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
        CROSS JOIN LATERAL aclexplode(d.defaclacl) x
      WHERE n.nspname = 'public'
    ) grants`,
  );
assert.equal(grantSnapshot(target), grantSnapshot('postgres'), 'Recovered public grants differ');

const ownerSnapshot = (database) =>
  sql(
    database,
    `SELECT COALESCE(string_agg(entry, E'\\n' ORDER BY entry), '') FROM (
      SELECT 'SCHEMA:' || n.nspname || ':' || pg_get_userbyid(n.nspowner) AS entry
      FROM pg_namespace n WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'RELATION:' || n.nspname || '.' || c.relname || ':' || pg_get_userbyid(c.relowner)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f', 'i', 'I')
      UNION ALL
      SELECT 'ROUTINE:' || n.nspname || '.' || p.oid::regprocedure::text || ':' || pg_get_userbyid(p.proowner)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'TYPE:' || n.nspname || '.' || t.typname || ':' || pg_get_userbyid(t.typowner)
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
    ) owners`,
  );
assert.equal(ownerSnapshot(target), ownerSnapshot('postgres'), 'Recovered public owners differ');
const requiredRoles = sql(
  target,
  "SELECT count(*)::text FROM pg_roles WHERE rolname IN ('supabase_admin', 'anon', 'authenticated', 'service_role')",
);
assert.equal(requiredRoles, '4', 'Required Supabase roles are missing from the restore target');

const foreignKeySnapshot = (database) =>
  sql(
    database,
    `SELECT COALESCE(string_agg(
      format('%I.%I:%I:%s:%s', n.nspname, c.relname, k.conname,
        pg_get_constraintdef(k.oid, true), k.convalidated), E'\\n' ORDER BY n.nspname, c.relname, k.conname), '')
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND k.contype = 'f'`,
  );
assert.equal(foreignKeySnapshot(target), foreignKeySnapshot('postgres'), 'Recovered FKs differ');
assert.equal(
  sql(
    target,
    "SELECT count(*)::text FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND k.contype = 'f' AND NOT k.convalidated",
  ),
  '0',
  'Restore target has unvalidated foreign keys',
);

const structureSnapshot = (database) =>
  sql(
    database,
    `SELECT COALESCE(string_agg(entry, E'\\n' ORDER BY entry), '') FROM (
      SELECT 'COLUMN:' || c.relname || ':' || a.attnum::text || ':' || a.attname || ':' ||
        format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' ||
        COALESCE(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attidentity || ':' || a.attgenerated AS entry
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'CONSTRAINT:' || c.relname || ':' || k.conname || ':' || pg_get_constraintdef(k.oid, true)
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'INDEX:' || c.relname || ':' || i.relname || ':' || pg_get_indexdef(i.oid)
      FROM pg_index x
      JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'TRIGGER:' || c.relname || ':' || t.tgname || ':' || pg_get_triggerdef(t.oid, true) || ':' || t.tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
      UNION ALL
      SELECT 'POLICY:' || c.relname || ':' || p.polname || ':' || p.polcmd || ':' ||
        (SELECT COALESCE(string_agg(COALESCE(r.rolname, 'PUBLIC'), ',' ORDER BY COALESCE(r.rolname, 'PUBLIC')), '')
         FROM unnest(p.polroles) AS roles(role_oid)
         LEFT JOIN pg_roles r ON r.oid = roles.role_oid) || ':' ||
        COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || ':' ||
        COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'RLS:' || c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ) objects`,
  );
assert.equal(
  structureSnapshot(target),
  structureSnapshot('postgres'),
  'Recovered structure differs',
);
const directory = join(process.env.RUNNER_TEMP, 'livio-integrated-artifacts');
mkdirSync(directory, { recursive: true });
writeFileSync(
  join(directory, 'restore-rehearsal.json'),
  JSON.stringify(
    {
      status: 'PASS',
      scope:
        'Synthetic disposable database; public table set and data, financial totals, sequences, owners, grants, structure and foreign keys compared',
      tables: tables.length,
      sequences: sequenceSnapshot('postgres').split('\n').filter(Boolean).length,
      requiredSupabaseRoles: Number(requiredRoles),
      publicOwnersCompared: true,
      publicGrantsCompared: true,
      foreignKeysComparedAndValidated: true,
      financialTotalsCompared: recoveredFinancials,
      excludedSchedulerTocEntries: excludedTocEntries.length,
      excludedSchedulerSchemasAbsent: true,
      elapsedMs: Date.now() - started,
      limitations: [
        'Not the historical shared public backup',
        'Storage objects not restored',
        'Hosted Auth configuration and external secrets not restored',
        'Global roles are not created by pg_dump; required runner roles are checked',
        'Scheduler extensions and jobs are deliberately excluded',
      ],
    },
    null,
    2,
  ),
);
console.log(`Restore rehearsal passed: ${tables.length} public tables`);
