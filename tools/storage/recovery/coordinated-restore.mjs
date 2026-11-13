import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runtime, snapshot } from './runtime.mjs';
import { restoreFixture } from './restore-fixture.mjs';
import { independentRecovery } from './independent-process.mjs';
import { assertOwnedStack, docker, ownContainer, sql } from './stack-identity.mjs';
import { validateRecoveryEnvironment } from './environment.mjs';
import { withFinancialApi } from '../../qa/run-financial-integrity-ci.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const schemas = "'public','auth','storage','supabase_migrations'";
function cli(args, env) {
  // CLI output includes local credentials. Never print it, including on error.
  try {
    return execFileSync(resolve('node_modules/.bin/supabase'), args, {
      env,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('DISPOSABLE_RESTORE_CLI_FAILED');
  }
}
function services(project) {
  const names = docker([
    'ps',
    '-a',
    '--filter',
    `label=com.supabase.cli.project=${project}`,
    '--format',
    '{{.Names}}',
  ])
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);
  assert.ok(names.includes(`supabase_db_${project}`));
  for (const name of names) assert.ok(name.startsWith('supabase_') && name.endsWith('_' + project));
  return names.filter((n) => n !== `supabase_db_${project}`);
}
function quiesce(project) {
  const names = services(project);
  if (names.length) docker(['stop', ...names]);
  return names;
}
function assertFreshDestination(target, source) {
  assert.notEqual(target.project, source.project);
  assert.notEqual(target.cluster, source.cluster);
  assert.notEqual(target.volume, source.volume);
  assert.equal(ownContainer('db', target.project).Id, target.databaseContainer);
  assert.equal(
    sql(target.project, 'SELECT system_identifier::text FROM pg_control_system();')
      .toString()
      .trim(),
    target.cluster,
  );
  const storage = ownContainer('storage', target.project, false);
  assert.equal(
    storage.Mounts.find((m) => m.Destination === '/var/lib/storage')?.Name,
    target.volume,
  );
}
function inventory(project) {
  const tables = JSON.parse(
    sql(
      project,
      `SELECT coalesce(json_agg(json_build_object('schema',n.nspname,'name',c.relname) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (${schemas}) AND c.relkind IN ('r','p');`,
    ).toString(),
  );
  return tables.map((t) => ({
    ...t,
    sha256: hash(
      sql(
        project,
        `SELECT to_jsonb(t)::text FROM ${quote(t.schema)}.${quote(t.name)} t ORDER BY to_jsonb(t)::text;`,
      ),
    ),
    count: Number(
      sql(project, `SELECT count(*) FROM ${quote(t.schema)}.${quote(t.name)};`).toString(),
    ),
  }));
}
function sequenceState(project) {
  const sequences = JSON.parse(
    sql(
      project,
      `SELECT coalesce(json_agg(json_build_array(schemaname,sequencename) ORDER BY schemaname,sequencename),'[]') FROM pg_sequences WHERE schemaname IN (${schemas});`,
    ).toString(),
  );
  return sequences.map(([schema, name]) => ({
    schema,
    name,
    value: sql(project, `SELECT last_value::text,is_called FROM ${quote(schema)}.${quote(name)};`)
      .toString()
      .trim(),
  }));
}
function catalog(project) {
  // OIDs differ across independent clusters. Compare names and definitions.
  const queries = [
    `SELECT nspname,pg_get_userbyid(nspowner),nspacl::text FROM pg_namespace WHERE nspname IN (${schemas}) ORDER BY 1`,
    `SELECT schemaname,sequencename,sequenceowner,data_type,start_value,min_value,max_value,increment_by,cycle FROM pg_sequences WHERE schemaname IN (${schemas}) ORDER BY 1,2`,
    `SELECT n.nspname,t.typname,pg_get_userbyid(t.typowner),e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN (${schemas}) ORDER BY 1,2,e.enumsortorder`,

    `SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relacl::text,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (${schemas}) ORDER BY 1,2`,
    `SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,p.prosecdef,p.provolatile,p.proparallel,p.proconfig::text,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN (${schemas}) AND p.prokind='f' ORDER BY 1,2,3`,
    `SELECT schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname IN (${schemas}) ORDER BY 1,2,3`,
    `SELECT n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (${schemas}) AND NOT t.tgisinternal ORDER BY 1,2,3`,
    `SELECT n.nspname,c.relname,a.attname,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (${schemas}) AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,a.attnum`,
    `SELECT pg_get_userbyid(d.defaclrole),coalesce(n.nspname,''),d.defaclobjtype,d.defaclacl::text FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY 1,2,3`,
    `SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY 1`,
    `SELECT pg_get_userbyid(roleid),pg_get_userbyid(member),admin_option FROM pg_auth_members ORDER BY 1,2`,
    `SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid),k.convalidated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (${schemas}) ORDER BY 1,2,3`,
  ];
  return queries.map((q) => hash(sql(project, q + ';')));
}
function foreignKeys(project) {
  // Re-scan restored rows: convalidated=true alone proves nothing when restore
  // used a session with replication_role=replica to replay immutable history.
  const checks = JSON.parse(
    sql(
      project,
      `SELECT coalesce(json_agg(q ORDER BY q->>'name'),'[]') FROM (SELECT json_build_object('name',k.conname,'child',format('%I.%I',n.nspname,c.relname),'parent',k.confrelid::regclass::text,'match',k.confmatchtype,'columns',(SELECT json_agg(a.attname ORDER BY u.ordinality) FROM unnest(k.conkey) WITH ORDINALITY u(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.attnum),'parents',(SELECT json_agg(a.attname ORDER BY u.ordinality) FROM unnest(k.confkey) WITH ORDINALITY u(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=u.attnum)) q FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='f' AND n.nspname IN (${schemas})) s;`,
    ).toString(),
  );
  for (const c of checks) {
    const allNonNull = c.columns.map((x) => `c.${quote(x)} IS NOT NULL`).join(' AND ');
    const allNull = c.columns.map((x) => `c.${quote(x)} IS NULL`).join(' AND ');
    const equality = c.columns
      .map((x, i) => `p.${quote(c.parents[i])}=c.${quote(x)}`)
      .join(' AND ');
    const invalid =
      c.match === 'f'
        ? `(NOT (${allNull}) AND NOT (${allNonNull})) OR ((${allNonNull}) AND NOT EXISTS(SELECT 1 FROM ${c.parent} p WHERE ${equality}))`
        : `(${allNonNull}) AND NOT EXISTS(SELECT 1 FROM ${c.parent} p WHERE ${equality})`;
    assert.equal(
      Number(sql(project, `SELECT count(*) FROM ${c.child} c WHERE ${invalid};`).toString()),
      0,
      `Restored FK ${c.name}`,
    );
  }
  return checks.length;
}
function copyVolume(image, source, destination, privateRoot) {
  const script = resolve('tools/storage/recovery/volume-copy.mjs');
  return JSON.parse(
    docker(
      [
        'run',
        '--rm',
        '--pull=never',
        '--network',
        'none',
        '--user',
        '0',
        '--read-only',
        '--entrypoint',
        'node',
        '--mount',
        source,
        '--mount',
        destination,
        '--mount',
        `type=bind,src=${script},dst=/copy.mjs,readonly`,
        image,
        '/copy.mjs',
        '/source',
        '/destination',
      ],
      { cwd: privateRoot },
    ).toString(),
  );
}
function targetEnvironment(env, scratch, project) {
  const values = new Map();
  for (const line of cli(['status', '--workdir', scratch, '--output', 'env'], env)
    .toString()
    .split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) values.set(m[1], m[2].startsWith('"') ? JSON.parse(m[2]) : m[2]);
  }
  for (const key of ['API_URL', 'DB_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY'])
    assert.ok(values.get(key));
  const url = new URL(values.get('DB_URL'));
  url.searchParams.set('schema', 'public');
  url.searchParams.set('connection_limit', '4');
  const next = {
    ...env,
    DATABASE_URL: url.href,
    SUPABASE_URL: values.get('API_URL'),
    NEXT_PUBLIC_SUPABASE_URL: values.get('API_URL'),
    SUPABASE_ANON_KEY: values.get('ANON_KEY'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: values.get('ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: values.get('SERVICE_ROLE_KEY'),
    LIVIO_RECOVERY_PROJECT: project,
  };
  delete next.LIVIO_RECOVERY_CLUSTER;
  validateRecoveryEnvironment(next);
  return next;
}

export async function coordinatedRestore(env) {
  validateRecoveryEnvironment(env);
  const evidence = {
    result: 'FAIL',
    phase: 'SOURCE',
    scope:
      'Fresh independent disposable PostgreSQL cluster AND physical Storage volume; no hosted services',
  };
  const publicPath = join(env.LIVIO_QA_OUTPUT, 'coordinated-restore.json');
  const save = () =>
    writeFileSync(
      publicPath,
      JSON.stringify(evidence, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
    );
  const privateRoot = join(
    env.RUNNER_TEMP,
    'livio-recovery-private-' + randomBytes(8).toString('hex'),
  );
  mkdirSync(privateRoot, { mode: 0o700 });
  const volumeBackup = join(privateRoot, 'objects');
  mkdirSync(volumeBackup, { mode: 0o700 });
  const scratch = join(privateRoot, 'target');
  mkdirSync(join(scratch, 'supabase'), { recursive: true });
  const project = `livio-recovery-${env.GITHUB_RUN_ID}-${randomBytes(4).toString('hex')}`;
  let r,
    targetStarted = false,
    fixtureData,
    source,
    target,
    targetEnv;
  try {
    r = await runtime(env);
    source = await assertOwnedStack(r.db, env);
    assert.equal(source.project, 'livio-legal-crm');
    fixtureData = await restoreFixture(r);
    await r.db.$disconnect();
    r = null;
    // No API remains: run-ci awaits withFinancialApi cleanup before entering.
    quiesce(source.project);
    const sourceTransactions = JSON.parse(
      sql(
        source.project,
        "SELECT coalesce(json_agg(pid),'[]') FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid() AND xact_start IS NOT NULL;",
      ).toString(),
    );
    assert.deepEqual(sourceTransactions, [], 'Source must be quiescent before backup');
    if (
      sql(source.project, "SELECT to_regclass('cron.job') IS NOT NULL;").toString().trim() === 't'
    )
      assert.equal(
        Number(sql(source.project, 'SELECT count(*) FROM cron.job WHERE active;').toString()),
        0,
        'Commercial/scheduled jobs must be absent in this rehearsal',
      );
    const sourceCatalog = catalog(source.project),
      sourceRows = inventory(source.project);
    const archive = '/tmp/livio-recovery-' + randomBytes(8).toString('hex') + '.dump';
    docker([
      'exec',
      source.databaseContainer,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-Fc',
      '-n',
      'public',
      '-n',
      'auth',
      '-n',
      'storage',
      '-n',
      'supabase_migrations',
      '-f',
      archive,
    ]);
    docker(['cp', `${source.databaseContainer}:${archive}`, join(privateRoot, 'database.dump')]);
    const sequences = sequenceState(source.project);
    const objects = copyVolume(
      source.storageImage,
      `type=volume,src=${source.volume},dst=/source,readonly`,
      `type=bind,src=${volumeBackup},dst=/destination`,
      privateRoot,
    );
    assert.ok(objects.length, 'Physical Storage backup must contain real bytes');
    evidence.source = source;
    evidence.backup = {
      archiveSha256: hash(readFileSync(join(privateRoot, 'database.dump'))),
      archiveScope:
        'DDL and data for public/auth/storage/supabase_migrations; DDL restored by matching versioned migrations, data replayed from archive; cron/net excluded',
      objects,
      rows: sourceRows,
      sequences,
      catalog: sourceCatalog,
    };
    evidence.before = fixtureData.before;
    evidence.crash = fixtureData.crash;
    save();
    evidence.phase = 'TARGET_CREATION';
    let config = readFileSync('supabase/config.toml', 'utf8')
      .replace(/^project_id\s*=.*$/m, `project_id = "${project}"`)
      .replace(/\[db.seed\]\s*enabled\s*=\s*true/, '[db.seed]\nenabled = false');
    writeFileSync(join(scratch, 'supabase/config.toml'), config);
    cpSync('supabase/migrations', join(scratch, 'supabase/migrations'), { recursive: true });
    cli(['stop', '--project-id', source.project], env);
    // Refuse any previous resource with the destination identity before start.
    const names = docker([
      'ps',
      '-a',
      '--filter',
      `label=com.supabase.cli.project=${project}`,
      '--format',
      '{{.ID}}',
    ])
      .toString()
      .trim();
    assert.equal(names, '');
    writeFileSync(
      join(env.LIVIO_QA_OUTPUT, 'recovery-target.json'),
      JSON.stringify({ project, sourceCluster: source.cluster }) + '\n',
    );
    targetStarted = true;
    cli(
      [
        'start',
        '--workdir',
        scratch,
        '--exclude',
        'studio,imgproxy,realtime,edge-runtime,logflare,vector,postgres-meta',
      ],
      env,
    );
    targetEnv = targetEnvironment(env, scratch, project);
    // Verify the new cluster identity before the explicitly local reset. This
    // guard intentionally does not require the recovery migration yet.
    const { PrismaClient } = createRequire(import.meta.url)('@prisma/client');
    const fresh = new PrismaClient({ datasources: { db: { url: targetEnv.DATABASE_URL } } });
    try {
      target = await assertOwnedStack(fresh, targetEnv);
      assert.notEqual(target.cluster, source.cluster);
      assert.notEqual(target.volume, source.volume);
    } finally {
      await fresh.$disconnect();
    }
    cli(['db', 'reset', '--local', '--yes', '--workdir', scratch], env);
    r = await runtime(targetEnv);
    target = await assertOwnedStack(r.db, targetEnv);
    await r.db.$disconnect();
    r = null;
    assert.notEqual(target.cluster, source.cluster);
    assert.notEqual(target.volume, source.volume);
    assert.notEqual(target.databaseContainer, source.databaseContainer);
    assert.equal(target.storageImage, source.storageImage);
    assert.equal(
      target.tenantId,
      source.tenantId,
      'Provider namespace must match the physical archive layout',
    );
    targetEnv.LIVIO_RECOVERY_CLUSTER = target.cluster;
    const targetServices = quiesce(project);
    assert.deepEqual(
      catalog(project),
      sourceCatalog,
      'Migrations, owners, grants, RLS and functions must match before data restore',
    );
    evidence.target = target;
    evidence.phase = 'RESTORE';
    save();
    assertFreshDestination(target, source);
    // Explicit tables only, no CASCADE, no shared/hosted URL and no schema DROP.
    const targetRows = inventory(project);
    assert.deepEqual(
      targetRows.map((t) => [t.schema, t.name]),
      sourceRows.map((t) => [t.schema, t.name]),
    );
    sql(
      project,
      `BEGIN; SET LOCAL session_replication_role=replica; TRUNCATE TABLE ${targetRows.map((t) => 'ONLY ' + quote(t.schema) + '.' + quote(t.name)).join(',')} RESTART IDENTITY; COMMIT;`,
    );
    docker([
      'cp',
      join(privateRoot, 'database.dump'),
      `${target.databaseContainer}:/tmp/restore.dump`,
    ]);
    docker([
      'exec',
      '-e',
      'PGOPTIONS=-c session_replication_role=replica',
      target.databaseContainer,
      'pg_restore',
      '--exit-on-error',
      '--data-only',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '/tmp/restore.dump',
    ]);
    assert.deepEqual(
      inventory(project),
      sourceRows,
      'Every restored row must match before services mutate timestamps',
    );
    assert.deepEqual(
      catalog(project),
      sourceCatalog,
      'Restore cannot relax owners/grants/RLS/triggers',
    );
    assert.deepEqual(
      sequenceState(project),
      sequences,
      'Sequence values and is_called must restore exactly',
    );
    evidence.foreignKeysRescanned = foreignKeys(project);
    assertFreshDestination(target, source);
    const restoredObjects = copyVolume(
      target.storageImage,
      `type=bind,src=${volumeBackup},dst=/source,readonly`,
      `type=volume,src=${target.volume},dst=/destination`,
      privateRoot,
    );
    assert.deepEqual(restoredObjects, objects, 'Physical Storage files and hashes differ');
    docker(['start', ...targetServices]);
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(targetEnv.SUPABASE_URL + '/auth/v1/health', {
          headers: { apikey: targetEnv.SUPABASE_ANON_KEY },
          signal: AbortSignal.timeout(2000),
        });
        await response.body?.cancel();
        if (response.status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* bounded restored-provider readiness; original restore still fails on deadline */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Restored Auth readiness deadline');
    r = await runtime(targetEnv);
    const restored = [];
    for (const org of fixtureData.organizations) restored.push(await snapshot(r, org));
    assert.deepEqual(
      restored,
      fixtureData.before,
      'Restored links, intents, events, incidents and physical hashes differ',
    );
    const require = createRequire(import.meta.url),
      { createClient } = require('@supabase/supabase-js');
    const auth = createClient(targetEnv.SUPABASE_URL, targetEnv.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { email, password, profileId } = fixtureData.input.restoreCredentials;
    const login = await auth.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null);
    assert.equal(login.data.user.id, profileId);
    evidence.auth = { restoredIdentity: profileId, login: 'PASS' };
    mkdirSync(join(privateRoot, 'api'));
    await withFinancialApi(
      {
        api: {
          ...targetEnv,
          STORAGE_RECOVERY_DISPATCH_ENABLED: 'false',
          STORAGE_RECOVERY_DELETE_ENABLED: 'false',
        },
        output: join(privateRoot, 'api'),
      },
      process.cwd(),
      async () => {
        const response = await fetch(
          targetEnv.NEXT_PUBLIC_API_URL + '/clients/' + fixtureData.input.clientId,
          {
            headers: {
              Authorization: 'Bearer ' + login.data.session.access_token,
              'X-Organization-Id': fixtureData.input.actor.organizationId,
            },
            signal: AbortSignal.timeout(20000),
          },
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).id, fixtureData.input.clientId);
        evidence.api = { http: 200, clientId: fixtureData.input.clientId };
        const foreign = await fetch(
          targetEnv.NEXT_PUBLIC_API_URL + '/clients/' + fixtureData.interrupted.clientId,
          {
            headers: {
              Authorization: 'Bearer ' + login.data.session.access_token,
              'X-Organization-Id': fixtureData.input.actor.organizationId,
            },
            signal: AbortSignal.timeout(20000),
          },
        );
        assert.equal(foreign.status, 404);
        await foreign.body?.cancel();
        evidence.api.foreignHttp = foreign.status;
      },
    );
    for (const org of fixtureData.organizations) {
      await r.db.storageUploadIntent.updateMany({
        where: { organizationId: org },
        data: { dueAt: new Date(0), leaseUntil: new Date(0) },
      });
      await r.db.documentSigningRequest.updateMany({
        where: { organizationId: org, status: 'PROCESSING' },
        data: { processingLeaseUntil: new Date(0) },
      });
    }
    await r.db.$disconnect();
    r = null;
    evidence.phase = 'NEW_PROCESS_RECOVERY';
    evidence.recovered = [];
    for (const org of fixtureData.organizations) {
      const child = await independentRecovery({ actor: { organizationId: org } }, targetEnv);
      evidence.recovered.push(child);
    }
    r = await runtime(targetEnv);
    const after = [];
    for (const org of fixtureData.organizations) after.push(await snapshot(r, org));
    for (let i = 0; i < after.length; i++) {
      assert.deepEqual(after[i].versions, fixtureData.before[i].versions);
      assert.deepEqual(after[i].photos, fixtureData.before[i].photos);
      for (const version of after[i].versions) {
        const object = after[i].objects.find((o) => o.key === version.storageKey);
        assert.equal(object?.observation.status, 'PRESENT');
        assert.equal(object.observation.sha256, version.sha256);
      }
      for (const object of fixtureData.before[i].objects.filter((o) =>
        ['COMPLETE', 'RETAINED'].includes(
          fixtureData.before[i].intents.find((p) => p.id === o.id).state,
        ),
      )) {
        const now = after[i].objects.find((o) => o.id === object.id);
        assert.deepEqual(now.observation, object.observation);
      }
    }
    assert.deepEqual(
      after[0].signatures,
      fixtureData.before[0].signatures,
      'Completed signing and hashes must remain unchanged',
    );
    assert.equal(
      (await r.db.storageUploadIntent.findUniqueOrThrow({ where: { id: fixtureData.pending } }))
        .state,
      'ABSENT',
    );
    assert.equal(
      (await r.db.storageUploadIntent.findUniqueOrThrow({ where: { id: fixtureData.held } })).state,
      'RETAINED',
    );
    assert.equal(
      (await r.db.storageUploadIntent.findUniqueOrThrow({ where: { id: fixtureData.absent } }))
        .state,
      'ABSENT',
    );
    assert.equal(
      (
        await r.db.documentSigningRequest.findUniqueOrThrow({
          where: { id: fixtureData.interrupted.signingId },
        })
      ).status,
      'PENDING',
    );
    evidence.after = after;
    evidence.result = 'PASS';
    evidence.phase = 'COMPLETE';
  } catch (error) {
    evidence.error = { name: error.name, code: error.code ?? null, checkpoint: evidence.phase };
    throw error;
  } finally {
    await r?.db.$disconnect();
    if (targetStarted) {
      try {
        cli(['stop', '--project-id', project, '--no-backup'], env);
        evidence.targetStopped = true;
      } catch {
        evidence.cleanupFailure = true;
        evidence.result = 'FAIL';
      }
    }
    save();
  }
  assert.equal(evidence.result, 'PASS');
  return evidence;
}
