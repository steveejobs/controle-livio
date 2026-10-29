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
  run('psql', '-U', 'postgres', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query);
const started = Date.now();
run('pg_dump', '-U', 'postgres', '-d', 'postgres', '-Fc', '-f', archive);
// Scheduler extensions are tied to the source database; do not activate external jobs in a restore.
const toc = run('pg_restore', '-l', archive)
  .split('\n')
  .filter(
    (line) =>
      !/\b(pg_cron|pg_net)\b/.test(line) &&
      !/\b(SCHEMA - (cron|net)|(?:TABLE|SEQUENCE|FUNCTION|ACL) (cron|net) )/.test(line),
  )
  .join('\n');
execFileSync('docker', ['exec', '-i', container, 'tee', restoreList], {
  input: toc,
  stdio: ['pipe', 'ignore', 'pipe'],
});
// createdb fails if the randomly named destination exists. Never clean or overwrite a database.
run('createdb', '-U', 'postgres', '-T', 'template0', target);
sql(target, 'ALTER SCHEMA public RENAME TO restore_bootstrap_empty');
run(
  'pg_restore',
  '-U',
  'postgres',
  '-d',
  target,
  '--exit-on-error',
  '--no-owner',
  '--no-acl',
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
for (const query of [
  "SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace",
  "SELECT count(*) FROM pg_policies WHERE schemaname='public'",
  "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relrowsecurity AND relforcerowsecurity",
  "SELECT count(*) FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)",
])
  assert.equal(sql(target, query), sql('postgres', query), 'Recovered structure differs');
const directory = join(process.env.RUNNER_TEMP, 'livio-integrated-artifacts');
mkdirSync(directory, { recursive: true });
writeFileSync(
  join(directory, 'restore-rehearsal.json'),
  JSON.stringify(
    {
      status: 'PASS',
      scope: 'Synthetic disposable database; full dump, public data and structure verified',
      tables: tables.length,
      elapsedMs: Date.now() - started,
      limitations: [
        'Not the historical shared public backup',
        'Storage objects not restored',
        'Hosted Auth configuration and external secrets not restored',
        'Owners, grants and scheduler extensions deliberately excluded',
      ],
    },
    null,
    2,
  ),
);
console.log(`Restore rehearsal passed: ${tables.length} public tables`);
