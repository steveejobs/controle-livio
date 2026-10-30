import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

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
run('pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '-Fc', '-f', archive);
// Scheduler extensions are tied to the source database; do not activate external jobs in a restore.
const toc = run('pg_restore', '-l', archive)
  .split('\n')
  .filter(
    (line) =>
      !/\b(pg_cron|pg_net)\b/.test(line) &&
      !/\b(?:SCHEMA - |(?:TABLE DATA|TABLE|SEQUENCE SET|SEQUENCE|VIEW|MATERIALIZED VIEW|FOREIGN TABLE|FUNCTION|PROCEDURE|AGGREGATE|TYPE|DOMAIN|POLICY|TRIGGER|RULE) |(?:ACL|COMMENT|SECURITY LABEL|DEFAULT ACL) - (?:SCHEMA|TABLE DATA|TABLE|SEQUENCE SET|SEQUENCE|VIEW|MATERIALIZED VIEW|FOREIGN TABLE|FUNCTION|PROCEDURE|AGGREGATE|TYPE|DOMAIN|POLICY|TRIGGER|RULE) )(?:cron|net)\b/.test(
        line,
      ),
  )
  .join('\n');
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
  '--no-owner',
  '--use-list',
  restoreList,
  archive,
);
const tables = sql(
  'postgres',
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
)
  .split('\n')
  .filter(Boolean);
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
      FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, '{}'::aclitem[])) x
      WHERE n.nspname = 'public'
      UNION ALL
      SELECT 'RELATION:' || n.nspname || '.' || c.relname || ':' || x.privilege_type || ':' ||
        CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END || ':' || x.is_grantable::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, '{}'::aclitem[])) x
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    ) grants`,
  );
assert.equal(grantSnapshot(target), grantSnapshot('postgres'), 'Recovered public grants differ');

const wrongOwnerCount = sql(
  target,
  `SELECT (
    (SELECT count(*) FROM pg_namespace WHERE nspname = 'public' AND pg_get_userbyid(nspowner) <> 'supabase_admin') +
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND pg_get_userbyid(c.relowner) <> 'supabase_admin')
  )::text`,
);
assert.equal(
  wrongOwnerCount,
  '0',
  'Recovered public objects do not follow the supabase_admin owner policy',
);
const requiredRoles = sql(
  target,
  "SELECT count(*)::text FROM pg_roles WHERE rolname IN ('supabase_admin', 'anon', 'authenticated', 'service_role')",
);
assert.equal(requiredRoles, '4', 'Required Supabase roles are missing from the restore target');

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
        'Synthetic disposable database; public data, financial totals, sequences, grants, structure and target owner policy verified',
      tables: tables.length,
      sequences: sequenceSnapshot('postgres').split('\n').filter(Boolean).length,
      requiredSupabaseRoles: Number(requiredRoles),
      publicObjectsUsingOwnerPolicy: 'supabase_admin',
      publicGrantsCompared: true,
      financialTotalsCompared: recoveredFinancials,
      elapsedMs: Date.now() - started,
      limitations: [
        'Not the historical shared public backup',
        'Storage objects not restored',
        'Hosted Auth configuration and external secrets not restored',
        'Original ownership is mapped to supabase_admin; global roles are not recreated',
        'Scheduler extensions and jobs are deliberately excluded',
      ],
    },
    null,
    2,
  ),
);
console.log(`Restore rehearsal passed: ${tables.length} public tables`);
