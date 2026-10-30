import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const excludedSchedulerSchemas = ['cron', 'net'];
const excludedSchedulerExtensions = new Set(['pg_cron', 'pg_net']);
const multiWordTocDescriptions = [
  'MATERIALIZED VIEW DATA',
  'PUBLICATION TABLES IN SCHEMA',
  'FOREIGN DATA WRAPPER',
  'SEQUENCE SET',
  'TABLE DATA',
  'DEFAULT ACL',
  'BLOB COMMENTS',
  'INDEX ATTACH',
  'SECURITY LABEL',
  'FK CONSTRAINT',
  'CHECK CONSTRAINT',
  'USER MAPPING',
];

// pg_restore TOC rows are structured as dump-id; catalog-id object-id description namespace tag owner.
const parseTocEntry = (line, knownOwners = new Set()) => {
  if (!line.trim() || line.trimStart().startsWith(';')) return null;
  const separator = line.indexOf(';');
  if (separator < 1 || !/^\d+$/.test(line.slice(0, separator).trim())) return null;
  const fields = line
    .slice(separator + 1)
    .trim()
    .split(/\s+/);
  // Some pg_restore rows, including EXTENSION entries, have no owner column.
  if (fields.length < 5) return null;
  const [catalogId, objectId] = fields;
  const description = multiWordTocDescriptions.find(
    (candidate) => fields.slice(2, 2 + candidate.split(' ').length).join(' ') === candidate,
  );
  const descriptionLength = description?.split(' ').length ?? 1;
  const resolvedDescription = description ?? fields[2];
  const namespace = fields[2 + descriptionLength];
  const tagAndOwner = fields.slice(3 + descriptionLength);
  const commentLikeEntry =
    resolvedDescription === 'COMMENT' || resolvedDescription === 'SECURITY LABEL';
  const candidateOwner = tagAndOwner.at(-1);
  const hasOwnerColumn =
    tagAndOwner.length > 1 && (!commentLikeEntry || knownOwners.has(candidateOwner));
  const owner = hasOwnerColumn ? candidateOwner : undefined;
  return {
    dumpId: Number(line.slice(0, separator).trim()),
    catalogId: Number(catalogId),
    objectId: Number(objectId),
    description: resolvedDescription,
    namespace,
    name: hasOwnerColumn ? tagAndOwner.slice(0, -1).join(' ') : tagAndOwner.join(' '),
    owner,
  };
};

const discoverTocOwners = (lines) => {
  const owners = new Set(['postgres', 'supabase_admin', 'pg_database_owner']);
  for (const line of lines) {
    const entry = parseTocEntry(line);
    if (entry?.owner && entry.description !== 'COMMENT' && entry.description !== 'SECURITY LABEL') {
      owners.add(entry.owner);
    }
  }
  return owners;
};

const referencesExcludedSchema = (entry) => {
  if (!entry) return false;
  if (excludedSchedulerSchemas.includes(entry.namespace)) return true;
  if (entry.description === 'SCHEMA' && excludedSchedulerSchemas.includes(entry.name)) return true;

  // COMMENT/SECURITY LABEL TOC rows put their object kind and name in the tag field.
  // Their namespace column is '-', so inspect that typed payload instead of the whole row text.
  if (entry.description === 'COMMENT' || entry.description === 'SECURITY LABEL') {
    const [targetKind, ...targetParts] = entry.name.split(' ');
    const targetName = targetParts.join(' ');
    if (targetKind === 'SCHEMA' && excludedSchedulerSchemas.includes(targetName)) return true;
    if (excludedSchedulerSchemas.includes(targetName.split(' ')[0] ?? '')) return true;
    const qualifiedName = targetName.split(/[ (]/, 1)[0] ?? '';
    if (excludedSchedulerSchemas.some((schema) => qualifiedName.startsWith(`${schema}.`)))
      return true;
  }
  return false;
};

const referencesExcludedScheduler = (entry) => {
  if (referencesExcludedSchema(entry)) return true;
  if (!entry) return false;
  if (entry.description === 'EXTENSION' && excludedSchedulerExtensions.has(entry.name)) return true;
  if (entry.description === 'COMMENT' || entry.description === 'SECURITY LABEL') {
    const [targetKind, ...targetParts] = entry.name.split(' ');
    return targetKind === 'EXTENSION' && excludedSchedulerExtensions.has(targetParts.join(' '));
  }
  return false;
};

const filterUnsupportedTocEntries = (entries, knownOwners = new Set()) =>
  entries.filter((line) => {
    const entry = parseTocEntry(line, knownOwners);
    return (
      entry?.description !== 'ACL' &&
      entry?.description !== 'DEFAULT ACL' &&
      !referencesExcludedScheduler(entry)
    );
  });

const listArguments = (archive) => [
  'pg_restore',
  '-l',
  '--exclude-schema=cron',
  '--exclude-schema=net',
  archive,
];

const restoreArguments = (target, restoreList, archive) => [
  'pg_restore',
  '-U',
  'supabase_admin',
  '-d',
  target,
  '--exit-on-error',
  '--no-acl',
  '--no-owner',
  ...excludedSchedulerSchemas.flatMap((schema) => ['--exclude-schema', schema]),
  '--use-list',
  restoreList,
  archive,
];
const dockerExecArguments = (container, args) => ['exec', container, ...args];

const normalizeDecimalText = (value) => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  assert(match, `Invalid decimal value in restore assertion: ${value}`);
  const whole = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const sign = match[1] === '-' && (whole !== '0' || fraction) ? '-' : '';
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
};
assert.equal(normalizeDecimalText('2400.0000'), '2400');
assert.equal(normalizeDecimalText('002400.0500'), '2400.05');
assert.equal(normalizeDecimalText('-0.000'), '0');
assert.notEqual(normalizeDecimalText('2400.0001'), normalizeDecimalText('2400.0000'));

const tocFixture = [
  '1233; 2615 2200 SCHEMA - cron postgres',
  '1233; 2615 2200 TABLE cron alter_job postgres',
  '1233; 0 16400 TABLE DATA cron jobs postgres',
  '1234; 0 0 ACL - FUNCTION cron.alter_job(bigint) postgres',
  '1234; 0 0 ACL - cron postgres',
  '1234; 0 0 DEFAULT ACL - DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA cron postgres',
  '1234; 0 0 COMMENT - SCHEMA cron postgres',
  '1234; 0 0 COMMENT - FUNCTION cron.alter_job(bigint) postgres',
  '7; 3079 19318 EXTENSION - pg_cron',
  '6; 3079 16664 EXTENSION - pg_net',
  '5443; 0 0 COMMENT - EXTENSION pg_cron',
  '5444; 0 0 COMMENT - EXTENSION pg_net',
  '5445; 0 0 COMMENT - EXTENSION pg_cron supabase_admin',
  '5448; 0 0 COMMENT - EXTENSION pg_net supabase_admin',
  '5449; 0 0 SECURITY LABEL - EXTENSION pg_cron',
  '5450; 0 0 SECURITY LABEL - EXTENSION pg_net supabase_admin',
  '1237; 2615 2200 SCHEMA - public supabase_admin',
  '1237; 2615 2200 COMMENT - SCHEMA public supabase_admin',
  '1237; 1259 16400 TABLE public clients supabase_admin',
  '1237; 0 16401 TABLE DATA public clients supabase_admin',
  '1237; 0 0 COMMENT - TABLE public.clients supabase_admin',
  '1238; 0 0 ACL - TABLE public clients supabase_admin',
];
const fixtureOwners = discoverTocOwners(tocFixture);
assert.deepEqual(
  filterUnsupportedTocEntries(tocFixture, fixtureOwners),
  [
    '1237; 2615 2200 SCHEMA - public supabase_admin',
    '1237; 2615 2200 COMMENT - SCHEMA public supabase_admin',
    '1237; 1259 16400 TABLE public clients supabase_admin',
    '1237; 0 16401 TABLE DATA public clients supabase_admin',
    '1237; 0 0 COMMENT - TABLE public.clients supabase_admin',
  ],
  'Scheduler schema objects/references and ACLs are removed while public structure and data remain',
);
assert.deepEqual(
  tocFixture
    .map((line) => parseTocEntry(line, fixtureOwners))
    .filter((entry) => entry?.description === 'EXTENSION')
    .map(({ description, namespace, name, owner }) => ({ description, namespace, name, owner })),
  [
    { description: 'EXTENSION', namespace: '-', name: 'pg_cron', owner: undefined },
    { description: 'EXTENSION', namespace: '-', name: 'pg_net', owner: undefined },
  ],
  'Ownerless extension rows preserve object type/name/schema from the actual pg_restore TOC layout',
);
assert.deepEqual(
  tocFixture
    .map((line) => parseTocEntry(line, fixtureOwners))
    .filter(
      (entry) =>
        (entry?.description === 'COMMENT' || entry?.description === 'SECURITY LABEL') &&
        entry.name.startsWith('EXTENSION '),
    )
    .map(({ description, name, owner }) => ({ description, name, owner })),
  [
    { description: 'COMMENT', name: 'EXTENSION pg_cron', owner: undefined },
    { description: 'COMMENT', name: 'EXTENSION pg_net', owner: undefined },
    { description: 'COMMENT', name: 'EXTENSION pg_cron', owner: 'supabase_admin' },
    { description: 'COMMENT', name: 'EXTENSION pg_net', owner: 'supabase_admin' },
    { description: 'SECURITY LABEL', name: 'EXTENSION pg_cron', owner: undefined },
    { description: 'SECURITY LABEL', name: 'EXTENSION pg_net', owner: 'supabase_admin' },
  ],
  'Ownerless and owned COMMENT/SECURITY LABEL rows retain the object tag and schema target',
);
assert(
  filterUnsupportedTocEntries(tocFixture, fixtureOwners)
    .map((line) => parseTocEntry(line, fixtureOwners))
    .every((entry) => !referencesExcludedScheduler(entry)),
  'The filtered TOC must not retain scheduler schema or extension references',
);
const restorePlanFixture = restoreArguments(
  'livio_restore_fixture',
  '/tmp/restore.list',
  '/tmp/restore.dump',
);
assert.deepEqual(
  listArguments('/tmp/restore.dump'),
  ['pg_restore', '-l', '--exclude-schema=cron', '--exclude-schema=net', '/tmp/restore.dump'],
  'TOC preflight must apply pg_restore schema filters to the source list',
);
assert(restorePlanFixture.includes('--no-acl'), 'Restore must suppress source ACL statements');
assert(restorePlanFixture.includes('--no-owner'), 'Restore must use the disposable runner owner');
assert(
  restorePlanFixture.includes('--exclude-schema') &&
    restorePlanFixture.includes('cron') &&
    restorePlanFixture.includes('net'),
  'Restore must exclude both scheduler schemas using pg_restore schema filters',
);
assert.deepEqual(
  dockerExecArguments('supabase_db_livio-legal-crm', restorePlanFixture),
  ['exec', 'supabase_db_livio-legal-crm', ...restorePlanFixture],
  'Docker must execute pg_restore inside the disposable database container',
);
if (process.argv.includes('--check-toc-filter')) {
  console.log('Restore plan fixtures passed; no database or backup was accessed.');
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
  execFileSync('docker', dockerExecArguments(container, args), {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
const sql = (database, query) =>
  run('psql', '-U', 'supabase_admin', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', query);
const started = Date.now();
const evidenceDirectory = join(process.env.RUNNER_TEMP, 'livio-integrated-artifacts');
mkdirSync(evidenceDirectory, { recursive: true });
const evidencePath = join(evidenceDirectory, 'restore-rehearsal.json');
let restoreStage = 'temporary_dump';
const writeCheckpoint = (details = {}) =>
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        status: 'INCOMPLETE',
        stage: restoreStage,
        elapsedMs: Date.now() - started,
        ...details,
      },
      null,
      2,
    ),
  );
writeCheckpoint({ targetDatabase: target });
// Scheduler extensions are tied to the source database; do not activate external jobs in a restore.
run('pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '-Fc', '-f', archive);
restoreStage = 'archive_toc_preflight';
const sourceToc = run('pg_restore', '-l', archive).split('\n');
const schemaFilteredToc = run(...listArguments(archive)).split('\n');
const tocOwners = discoverTocOwners(sourceToc);
const tocEntries = sourceToc.map((line) => ({ line, entry: parseTocEntry(line, tocOwners) }));
const excludedExtensionEntries = tocEntries.filter(
  ({ entry }) => entry?.description === 'EXTENSION' && excludedSchedulerExtensions.has(entry.name),
);
const aclEntries = tocEntries.filter(
  ({ entry }) => entry?.description === 'ACL' || entry?.description === 'DEFAULT ACL',
);
const cronAlterJobTocEntries = tocEntries
  .filter(({ line, entry }) => entry?.description === 'ACL' && /alter_job/i.test(line))
  .map(({ line }) => line.trim());
const sourceSchedulerReferences = tocEntries
  .filter(({ entry }) => referencesExcludedScheduler(entry))
  .map(({ line }) => line.trim());
const schedulerReferencesRemainingAfterNativeFilter = schemaFilteredToc
  .filter((line) => referencesExcludedScheduler(parseTocEntry(line, tocOwners)))
  .map((line) => line.trim());
const tocEvidence = {
  sourceTocEntries: tocEntries.filter(({ entry }) => entry).length,
  sourceAclRows: aclEntries.length,
  sourceSchedulerReferences,
  nativeSchemaFilterApplied: true,
  schemaFilterListArguments: listArguments(archive).slice(1),
  schemaFilteredTocEntries: schemaFilteredToc
    .map((line) => parseTocEntry(line, tocOwners))
    .filter(Boolean).length,
  schedulerReferencesRemainingAfterNativeFilter,
  schemaReferencesRemainingAfterNativeFilter: schemaFilteredToc
    .filter((line) => referencesExcludedSchema(parseTocEntry(line, tocOwners)))
    .map((line) => line.trim()),
  cronAlterJobAclTocRows: cronAlterJobTocEntries,
};
writeFileSync(join(evidenceDirectory, 'source-archive-toc.txt'), `${sourceToc.join('\n')}\n`);
writeCheckpoint({ targetDatabase: target, ...tocEvidence });
assert.equal(
  tocEvidence.schemaReferencesRemainingAfterNativeFilter.length,
  0,
  `pg_restore --exclude-schema left entries for absent scheduler schemas: ${JSON.stringify(tocEvidence.schemaReferencesRemainingAfterNativeFilter)}`,
);
const toc = filterUnsupportedTocEntries(schemaFilteredToc, tocOwners).join('\n');
writeFileSync(join(evidenceDirectory, 'schema-filtered-archive-toc.txt'), `${toc}\n`);
const residualUnsupportedReferences = toc
  .split('\n')
  .map((line) => parseTocEntry(line, tocOwners))
  .filter(referencesExcludedScheduler);
if (residualUnsupportedReferences.length > 0)
  throw new Error(
    `Restore list retains TOC entries for objects excluded from the destination: ${JSON.stringify(residualUnsupportedReferences)}`,
  );
const filteredTocEntries = toc
  .split('\n')
  .map((line) => parseTocEntry(line, tocOwners))
  .filter(Boolean);
const filteredTocEvidence = {
  effectiveRestoreTocEntries: filteredTocEntries.length,
  prohibitedReferencesAfterFinalFilter: residualUnsupportedReferences,
};
assert(
  !filteredTocEntries.some(
    (entry) => entry?.description === 'ACL' || entry?.description === 'DEFAULT ACL',
  ),
  'Source ACL TOC entries must be omitted; the runner reapplies only checked-in application grants',
);
const effectiveRestoreArgs = restoreArguments(target, restoreList, archive);
for (const requiredFlag of ['--no-acl', '--no-owner', '--exclude-schema', '--use-list'])
  assert(effectiveRestoreArgs.includes(requiredFlag), `Restore plan is missing ${requiredFlag}`);
assert(
  excludedSchedulerSchemas.every((schema) => effectiveRestoreArgs.includes(schema)),
  'Restore plan must exclude cron and net schemas using pg_restore native filters',
);
writeCheckpoint({
  targetDatabase: target,
  ...tocEvidence,
  ...filteredTocEvidence,
  effectiveRestoreArguments: effectiveRestoreArgs,
  schedulerExtensionRowsRemoved: excludedExtensionEntries.length,
  aclRowsSuppressedByNoAcl: aclEntries.length,
  cronAlterJobAclTocRows: cronAlterJobTocEntries,
  excludedSchedulerSchemas,
});
console.log(
  `Restore TOC preflight passed: ${tocEntries.filter(({ entry }) => entry?.description === 'SCHEMA' && excludedSchedulerSchemas.includes(entry.name)).length} scheduler schema rows excluded; ${excludedExtensionEntries.length} scheduler extension rows removed; ${aclEntries.length} ACL/default ACL rows removed from the TOC and suppressed with --no-acl; ${cronAlterJobTocEntries.length} alter_job ACL rows found.`,
);
execFileSync('docker', ['exec', '-i', container, 'tee', restoreList], {
  input: toc,
  stdio: ['pipe', 'ignore', 'pipe'],
});
// createdb fails if the randomly named destination exists. Never clean or overwrite a database.
run('createdb', '-U', 'supabase_admin', '-T', 'template0', target);
// PostgreSQL may omit the built-in public schema from the archive. Preserve it in that case.
if (
  toc
    .split('\n')
    .map((line) => parseTocEntry(line, tocOwners))
    .some((entry) => entry?.description === 'SCHEMA' && entry.name === 'public')
) {
  sql(target, 'ALTER SCHEMA public RENAME TO restore_bootstrap_empty');
}
restoreStage = 'pg_restore';
writeCheckpoint({
  targetDatabase: target,
  ...tocEvidence,
  ...filteredTocEvidence,
  effectiveRestoreArguments: effectiveRestoreArgs,
  schedulerExtensionRowsRemoved: excludedExtensionEntries.length,
  aclRowsSuppressedByNoAcl: aclEntries.length,
  cronAlterJobAclTocRows: cronAlterJobTocEntries,
  excludedSchedulerSchemas,
});
run(...effectiveRestoreArgs);
restoreStage = 'validate_recovery';
writeCheckpoint({
  targetDatabase: target,
  ...tocEvidence,
  ...filteredTocEvidence,
  pgRestoreCompleted: true,
  effectiveRestoreArguments: effectiveRestoreArgs,
  schedulerExtensionRowsRemoved: excludedExtensionEntries.length,
  aclRowsSuppressedByNoAcl: aclEntries.length,
  cronAlterJobAclTocRows: cronAlterJobTocEntries,
  excludedSchedulerSchemas,
});
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
const normalizeFinancialSnapshot = (database) => {
  const snapshot = JSON.parse(financialSnapshot(database));
  for (const totals of Object.values(snapshot)) totals.amount = normalizeDecimalText(totals.amount);
  return snapshot;
};
const financials = normalizeFinancialSnapshot('postgres');
const recoveredFinancials = normalizeFinancialSnapshot(target);
assert.deepEqual(recoveredFinancials, financials, 'Recovered financial totals differ');
assert.equal(
  recoveredFinancials.receivables.count,
  2,
  'Synthetic restore fixture must contain both known receivables',
);
assert.equal(
  recoveredFinancials.receivables.amount,
  normalizeDecimalText('2400.00'),
  'Synthetic restore fixture must contain the exact receivables total independent of NUMERIC scale',
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
const requiredRoles = sql(
  target,
  "SELECT count(*)::text FROM pg_roles WHERE rolname IN ('supabase_admin', 'anon', 'authenticated', 'service_role')",
);
assert.equal(requiredRoles, '4', 'Required Supabase roles are missing from the restore target');

// ACLs from the source are suppressed. Re-apply only the checked-in application grants.
sql(
  target,
  `BEGIN;
   GRANT USAGE ON SCHEMA public TO authenticated;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
   REVOKE ALL ON FUNCTION public.current_organization_ids() FROM PUBLIC;
   REVOKE ALL ON FUNCTION public.has_permission(uuid, text, text) FROM PUBLIC;
   REVOKE ALL ON FUNCTION public.current_client_id(uuid) FROM PUBLIC;
   REVOKE ALL ON FUNCTION public.can_access_client_resource(uuid, uuid, text, text) FROM PUBLIC;
   REVOKE ALL ON FUNCTION public.storage_object_organization_id(text) FROM PUBLIC;
   REVOKE ALL ON FUNCTION public.can_download_storage_object(text) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION public.current_organization_ids() TO authenticated;
   GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text, text) TO authenticated;
   GRANT EXECUTE ON FUNCTION public.current_client_id(uuid) TO authenticated;
   GRANT EXECUTE ON FUNCTION public.can_access_client_resource(uuid, uuid, text, text) TO authenticated;
   GRANT EXECUTE ON FUNCTION public.storage_object_organization_id(text) TO authenticated;
   GRANT EXECUTE ON FUNCTION public.can_download_storage_object(text) TO authenticated;
   COMMIT;`,
);

assert.equal(
  sql(
    target,
    `SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND NOT (has_table_privilege('authenticated', c.oid, 'SELECT')
         AND has_table_privilege('authenticated', c.oid, 'INSERT')
         AND has_table_privilege('authenticated', c.oid, 'UPDATE')
         AND has_table_privilege('authenticated', c.oid, 'DELETE'))`,
  ),
  '0',
  'Authenticated application table privileges are incomplete',
);
assert.equal(
  sql(
    target,
    `SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND (has_table_privilege('authenticated', c.oid, 'TRUNCATE')
         OR has_table_privilege('authenticated', c.oid, 'REFERENCES')
         OR has_table_privilege('authenticated', c.oid, 'TRIGGER'))`,
  ),
  '0',
  'Authenticated role received an application table privilege outside the checked-in policy',
);
assert.equal(
  sql(
    target,
    `SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('current_organization_ids', 'has_permission', 'current_client_id',
         'can_access_client_resource', 'storage_object_organization_id', 'can_download_storage_object')
       AND (NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
           WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE'))`,
  ),
  '0',
  'Security function grants do not match the checked-in authenticated-only policy',
);
assert(
  grantSnapshot(target).includes('SCHEMA:public:USAGE:authenticated:false'),
  'Application schema usage grant was not restored',
);
const restoredOwners = ownerSnapshot(target).split('\n').filter(Boolean);
assert(restoredOwners.length > 0, 'No public owners were found in the restore target');
assert(
  restoredOwners.every((entry) => entry.endsWith(':supabase_admin')),
  'Restore target objects must be owned by the disposable runner role because --no-owner is used',
);

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
assert(
  Number(
    sql(
      target,
      "SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('current_organization_ids', 'has_permission', 'current_client_id', 'can_access_client_resource', 'storage_object_organization_id', 'can_download_storage_object')",
    ),
  ) >= 6,
  'One or more checked-in security functions are missing from the restore target',
);
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
const databaseOwner = sql(
  target,
  'SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()',
);
assert.equal(databaseOwner, 'supabase_admin', 'Disposable restore database owner differs');
restoreStage = 'complete';
writeFileSync(
  evidencePath,
  JSON.stringify(
    {
      status: 'PASS',
      stage: restoreStage,
      targetDatabase: target,
      scope:
        'New disposable database; public tables, rows, sequences, financial totals, schema structure, FKs, controlled owners, and application grants verified',
      tables: tables.length,
      sequences: sequenceSnapshot('postgres').split('\n').filter(Boolean).length,
      requiredSupabaseRoles: Number(requiredRoles),
      databaseOwner,
      ...tocEvidence,
      ...filteredTocEvidence,
      publicObjectsOwnedBy: 'supabase_admin',
      applicationGrantsAppliedAndVerified: true,
      foreignKeysComparedAndValidated: true,
      financialTotalsCompared: recoveredFinancials,
      effectiveRestoreArguments: effectiveRestoreArgs,
      schedulerExtensionRowsRemoved: excludedExtensionEntries.length,
      aclRowsSuppressedByNoAcl: aclEntries.length,
      cronAlterJobAclTocRows: cronAlterJobTocEntries,
      excludedSchedulerSchemasAbsent: true,
      elapsedMs: Date.now() - started,
      limitations: [
        'Synthetic temporary source, not a historical shared backup',
        'Storage objects not restored',
        'Hosted Auth configuration and external secrets not restored',
        'Global roles are provided by the disposable Supabase runner and checked',
        'Source ACLs/owners are intentionally not replayed; checked-in application grants are applied explicitly',
        'Scheduler extensions and schemas are deliberately excluded',
      ],
    },
    null,
    2,
  ),
);
console.log(`Restore rehearsal passed: ${tables.length} public tables`);
