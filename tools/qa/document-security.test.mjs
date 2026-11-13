import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  storageDenial,
  diagnoseMatrixAttempt,
  storageWriteBarrier,
  storageOperations,
  duplicateDestinationControl,
  captureStorageControl,
  plannedStorageCells,
  runDocumentStorageMatrix,
} from './document-storage-matrix.mjs';
import { runClientScopeIntegrity } from './client-scope-integrity.mjs';
import {
  diagnoseStorageAttempt,
  planDeniesEveryRow,
  restrictiveBucketBoundary,
  sanitizeProviderPayload,
  inspectStorageCatalog,
  ordinaryStorageSession,
} from './storage-authorization-proof.mjs';
import { collectDiagnostics, failureFacts } from './supabase-start-diagnostics.mjs';

const require = createRequire(import.meta.url);
const { initialRolePermissions } = require('@livio/shared');
const yaml = require('js-yaml');
const file = 'supabase/migrations/20261112120000_document_storage_api_write_boundary.sql';
const sql = readFileSync(file, 'utf8');
test('effective SQL proof refuses ownership, BYPASSRLS, privileged SET, wrong identity and disabled RLS', () => {
  const identity = { profileId: 'synthetic-profile' };
  const session = {
    role: 'authenticated',
    profile_id: identity.profileId,
    rolsuper: false,
    rolbypassrls: false,
    owns_table: false,
    can_assume_privileged: false,
    relrowsecurity: true,
  };
  assert(ordinaryStorageSession(session, identity));
  for (const override of [
    { role: 'service_role' },
    { profile_id: 'other' },
    { rolsuper: true },
    { rolbypassrls: true },
    { owns_table: true },
    { can_assume_privileged: true },
    { can_assume_privileged: undefined },
    { relrowsecurity: false },
  ])
    assert(!ordinaryStorageSession({ ...session, ...override }, identity));
});
test('ambiguous Storage HTTP never proves security without independent SQL, identity and object evidence', () => {
  for (const response of [
    { http: 200, providerBody: [], kind: 'ACCEPTED_OR_AMBIGUOUS_NOOP' },
    { http: 400, code: 'NoSuchKey', kind: 'HARNESS_DOMAIN_OR_INFRA_FAILURE' },
  ]) {
    const base = {
      operation: response.http === 200 ? 'delete' : 'move',
      response,
      fixtureValid: true,
      serverExists: true,
      jwtValidated: true,
      unchanged: true,
      positiveControl: true,
      providerIdentified: true,
      writeBarrier: false,
      sourceVisible: false,
      missingControl: response,
    };
    assert.equal(diagnoseStorageAttempt(base).securityProven, false);
    assert.equal(
      diagnoseStorageAttempt({ ...base, writeBarrier: true, unchanged: false }).classification,
      'UNAUTHORIZED_MUTATION',
    );
    assert.equal(
      diagnoseStorageAttempt({ ...base, writeBarrier: true, serverExists: false }).classification,
      'INVALID_FIXTURE',
    );
    assert.equal(
      diagnoseStorageAttempt({ ...base, writeBarrier: true, jwtValidated: false }).securityProven,
      false,
    );
    assert.equal(
      diagnoseStorageAttempt({ ...base, writeBarrier: true, positiveControl: false })
        .securityProven,
      false,
    );
    assert.equal(
      diagnoseStorageAttempt({ ...base, writeBarrier: true, providerIdentified: false })
        .securityProven,
      false,
    );
  }
});
test('delete no-op classification requires empty matching missing-source control and effective SQL barrier', () => {
  const proof = {
    operation: 'delete',
    response: { http: 200, providerBody: [], kind: 'ACCEPTED_OR_AMBIGUOUS_NOOP' },
    fixtureValid: true,
    serverExists: true,
    jwtValidated: true,
    unchanged: true,
    positiveControl: true,
    providerIdentified: true,
    writeBarrier: true,
    missingControl: { http: 200, providerBody: [] },
  };
  assert.deepEqual(diagnoseStorageAttempt(proof), {
    classification: 'VALID_PROVIDER_NOOP',
    securityProven: true,
  });
  assert.equal(
    diagnoseStorageAttempt({ ...proof, missingControl: undefined }).securityProven,
    false,
  );
  assert.equal(
    diagnoseStorageAttempt({
      ...proof,
      response: { ...proof.response, providerBody: [{ name: 'deleted' }] },
    }).securityProven,
    false,
  );
});
test('move and copy classify source visibility separately; unexplained visible copy remains inconclusive', () => {
  const proof = {
    operation: 'move',
    response: { http: 400, code: 'NoSuchKey' },
    missingControl: { code: 'NoSuchKey' },
    fixtureValid: true,
    serverExists: true,
    jwtValidated: true,
    unchanged: true,
    positiveControl: true,
    providerIdentified: true,
    writeBarrier: true,
    sourceVisible: false,
  };
  assert.equal(diagnoseStorageAttempt(proof).classification, 'OBJECT_NOT_VISIBLE_PROVEN');
  assert.equal(
    diagnoseStorageAttempt({ ...proof, sourceVisible: true }).classification,
    'AUTHORIZATION_DENIED_PROVEN',
  );
  assert.equal(
    diagnoseStorageAttempt({ ...proof, operation: 'copy-new', sourceVisible: true }).classification,
    'INCONCLUSIVE',
  );
  assert.equal(diagnoseStorageAttempt({ ...proof, sourceVisible: null }).securityProven, false);
});
test('EXPLAIN evidence recognizes constant-false row sources without executing metadata DML', () => {
  assert(
    planDeniesEveryRow({
      'Node Type': 'ModifyTable',
      Plans: [{ 'Node Type': 'Result', 'One-Time Filter': 'false' }],
    }),
  );
  assert(!planDeniesEveryRow({ 'Node Type': 'Seq Scan', Filter: '(bucket_id = legal)' }));
  assert(!planDeniesEveryRow({ Plans: [{ Filter: 'false' }, { Filter: 'true' }] }));
  const source = readFileSync('tools/qa/storage-authorization-proof.mjs', 'utf8');
  assert(source.includes('EXPLAIN (FORMAT JSON, VERBOSE) DELETE'));
  assert.doesNotMatch(source, /EXPLAIN\s*\([^)]*ANALYZE/);
  assert.doesNotMatch(
    source,
    /\$executeRawUnsafe\(['"](?:DELETE|UPDATE|INSERT|CREATE|ALTER|GRANT)/,
  );
});
test('predicate proof rejects permissive, wrong-role, wrong-command or changed boundary policies', () => {
  const policy = {
    policyname: 'document_api_update_boundary',
    cmd: 'UPDATE',
    roles: '{anon,authenticated}',
    permissive: 'RESTRICTIVE',
    qual: "(bucket_id <> 'legal-documents'::text)",
    with_check: "(bucket_id <> 'legal-documents'::text)",
  };
  assert(restrictiveBucketBoundary([policy], 'authenticated', 'update'));
  for (const override of [
    { permissive: 'PERMISSIVE' },
    { roles: '{not_authenticated}' },
    { cmd: 'SELECT' },
    { qual: 'true' },
    { with_check: 'true' },
  ])
    assert(!restrictiveBucketBoundary([{ ...policy, ...override }], 'authenticated', 'update'));
});
test('Storage diagnostics redact signed capabilities and full credential-bearing messages', () => {
  const sanitized = sanitizeProviderPayload({
    token: 'secret',
    nested: { url: 'http://local/token', message: 'error https://local/?token=secret' },
    code: 'NoSuchKey',
  });
  assert(!JSON.stringify(sanitized).includes('secret'));
  assert.equal(sanitized.code, 'NoSuchKey');
});
test('DEF017 migration is atomic and adds only three restrictive bucket write policies', () => {
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.equal((sql.match(/CREATE POLICY/g) ?? []).length, 3);
  assert.equal((sql.match(/AS RESTRICTIVE/g) ?? []).length, 3);
  for (const op of ['INSERT', 'UPDATE', 'DELETE'])
    assert.match(sql, new RegExp('FOR ' + op + ' TO anon, authenticated'));
  assert.doesNotMatch(
    sql,
    /FOR (ALL|SELECT)|\b(?:DROP|TRUNCATE|GRANT|REVOKE)\b|UPDATE storage\.objects|DELETE FROM storage\.objects/i,
  );
  assert.doesNotMatch(sql, /'client-photos'|'document-signatures'/);
  assert.match(sql, /rolbypassrls/);
  assert.match(sql, /pg_has_role\(client_role, oid, 'SET'\)/);
  assert.match(sql, /pg_has_role\(client_role, relowner, 'USAGE'\)/);
  assert.match(sql, /relrowsecurity/);
  assert.match(sql, /NOT public/);
  const names = execFileSync('git', ['ls-files', 'supabase/migrations'], { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/);
  const financial = 'supabase/migrations/20261111120000_financial_api_write_boundary.sql';
  assert(names.includes(financial));
  assert(file > financial);
});

function seedViews(source) {
  const start = source.indexOf("OR (r.key = 'client' AND (");
  assert(start > 0);
  const block = source.slice(start, source.indexOf('ON CONFLICT DO NOTHING;', start));
  return /p\.resource IN \(([^)]+)\) AND p\.action = 'view'/
    .exec(block)[1]
    .split(',')
    .map((s) => s.trim().replaceAll("'", ''));
}
test('client seed grants canonical own-record view without any new write permission', () => {
  const current = readFileSync('supabase/seed.sql', 'utf8');
  assert(initialRolePermissions.client.includes('clients:view'));
  assert(seedViews(current).includes('clients'));
  const previous = current.replace(
    "('clients','matters','contracts','receivables','payments','documents','calendar')",
    "('matters','contracts','receivables','payments','documents','calendar')",
  );
  assert(
    !seedViews(previous).includes('clients'),
    'Before-repair seed must reproduce the mismatch',
  );
  assert.equal(
    current
      .replace(
        "('clients','matters','contracts','receivables','payments','documents','calendar')",
        "('matters','contracts','receivables','payments','documents','calendar')",
      )
      .replace(/\r\n/g, '\n'),
    previous.replace(/\r\n/g, '\n'),
  );
  assert(!initialRolePermissions.client.includes('clients:update'));
});

test('Storage classification rejects malformed payload, auth failures and silent success as proof', () => {
  assert.equal(storageOperations.length, 9);
  assert.equal(
    storageDenial(400, {
      statusCode: '403',
      code: 'AccessDenied',
      error: 'Unauthorized',
      message: 'new row violates row-level security policy',
    }),
    'AUTHORIZATION_DENIED',
  );
  assert.equal(
    storageDenial(403, { code: '42501', message: 'permission denied for table documents' }),
    'AUTHORIZATION_DENIED',
  );
  for (const [http, body] of [
    [200, []],
    [204, {}],
    [400, { message: 'InvalidKey' }],
    [404, { message: 'Object not found' }],
    [401, { message: 'Invalid JWT' }],
    [503, { message: 'provider unavailable' }],
  ])
    assert.notEqual(storageDenial(http, body), 'AUTHORIZATION_DENIED');
});

test('diagnostics retain classifications and own-container facts but never raw credentials', () => {
  const secret = 'postgresql://private-user:private-password@external.invalid/private';
  const calls = [];
  const run = (program, args) => {
    calls.push([program, ...args]);
    if (program === 'npx') return { status: 0, stdout: '2.112.0\n' + secret };
    if (args[0] === 'version') return { status: 0, stdout: '28.5.1' };
    if (args[0] === 'ps') return { status: 0, stdout: 'abcdef123456\n' };
    return {
      status: 0,
      stdout: JSON.stringify([
        {
          Name: '/supabase_db_livio-legal-crm',
          Config: { Env: [secret], Labels: { 'com.supabase.cli.project': 'livio-legal-crm' } },
          State: {
            Status: 'exited',
            ExitCode: 1,
            Error: secret,
            Health: { Status: 'unhealthy', Log: [{ Output: 'SQLSTATE 42601 ' + secret }] },
          },
        },
      ]),
    };
  };
  const r = collectDiagnostics(
    'start-failure',
    { status: 1, stdout: secret, stderr: 'failed to pull ghcr.io; no such host ' + secret },
    { env: { RUNNER_OS: 'Linux', ImageVersion: secret, GITHUB_RUN_ID: '1' }, run },
  );
  assert.equal(r.observations.dns, true);
  assert.equal(r.observations.imageDownload, true);
  assert.equal(r.containers[0].failureFacts.sql, true);
  assert.deepEqual(r.containers[0].failureFacts.sqlStates, ['42601']);
  assert.equal(r.containers[0].exitCode, 1);
  assert(!JSON.stringify(r).includes('private-password'));
  assert(!JSON.stringify(r).includes('external.invalid'));
  assert(calls.find((c) => c.includes('label=com.supabase.cli.project=livio-legal-crm')));
  assert.deepEqual(failureFacts('no classified error').observedHosts, []);
});

test('cleanup refuses external Docker contexts and distinguishes empty verified project', () => {
  const run = (_p, args) => ({
    status: 0,
    stdout: args[0] === 'version' ? '28.5.1' : args[0] === 'ps' ? '' : '2.112.0',
  });
  assert.equal(collectDiagnostics('cleanup', { status: 0 }, { env: {}, run }).cleanup, 'PASS');
  assert.equal(
    collectDiagnostics(
      'cleanup',
      { status: 0 },
      { env: { DOCKER_HOST: 'tcp://external.invalid' }, run },
    ).cleanup,
    'FAIL_OR_UNVERIFIED',
  );
});

test('workflow changes neither triggers nor permissions nor the four job scopes', () => {
  const current = yaml.load(readFileSync('.github/workflows/quality.yml', 'utf8'));
  assert.deepEqual(current.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(current.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(current.on.push.branches, ['main', 'validation/**']);
  assert.deepEqual(Object.keys(current.jobs).sort(), [
    'application',
    'financial-security',
    'supabase-isolation',
    'synthetic-restore',
  ]);
  for (const key of Object.keys(current.jobs)) assert.equal(current.jobs[key].needs, undefined);
  assert.match(
    readFileSync('.github/workflows/quality.yml', 'utf8'),
    /supabase-start-diagnostics\.mjs --cleanup-check/,
  );
});

test('copy-existing server control recognizes only the observed duplicate contract, never authorization proof', () => {
  for (const response of [
    { http: 400, code: 'KeyAlreadyExists', accepted: false },
    { http: 409, code: '409', accepted: false },
  ])
    assert.equal(duplicateDestinationControl(response), true);
  for (const response of [
    { http: 400, code: 'InvalidKey', accepted: false },
    { http: 403, code: 'AccessDenied', accepted: false },
    { http: 503, code: 'ServiceUnavailable', accepted: false },
    { http: 200, code: 'KeyAlreadyExists', accepted: true },
    { http: 409, code: 'InvalidKey', accepted: false },
    { http: 503, code: '409', accepted: false },
  ])
    assert.equal(duplicateDestinationControl(response), false);
  assert.equal(
    storageDenial(400, { message: 'KeyAlreadyExists' }),
    'HARNESS_DOMAIN_OR_INFRA_FAILURE',
  );
});

test('one failed server control preserves later independent controls and cleanup evidence', async () => {
  const results = [];
  const cleanup = [];
  for (const operation of ['update', 'copy-existing', 'insert']) {
    const control = { operation, status: 'FAIL' };
    await captureStorageControl(
      control,
      async () => {
        if (operation === 'update')
          throw Object.assign(new Error('synthetic failure'), { code: 'SYNTHETIC' });
        control.status =
          operation === 'copy-existing' ? 'UNSUPPORTED_EXISTING_DESTINATION' : 'PASS';
      },
      async () => {
        cleanup.push(operation);
      },
    );
    results.push(control);
  }
  assert.deepEqual(
    results.map((c) => c.status),
    ['FAIL', 'UNSUPPORTED_EXISTING_DESTINATION', 'PASS'],
  );
  assert.deepEqual(cleanup, ['update', 'copy-existing', 'insert']);
  assert(results.every((c) => c.cleaned === true));
  assert.equal(results[0].error.code, 'SYNTHETIC');
});

test('cleanup failure remains FAIL rather than silently declaring a supported operation', async () => {
  const control = { status: 'FAIL' };
  await captureStorageControl(
    control,
    async () => {
      control.status = 'PASS';
    },
    async () => {
      throw new Error('synthetic cleanup unavailable');
    },
  );
  assert.equal(control.status, 'FAIL');
  assert.equal(control.cleaned, false);
  assert.equal(control.cleanupError.name, 'Error');
});

test('client scope migration preserves helper ACLs and matches professional role classification', () => {
  const sql = readFileSync(
    'supabase/migrations/20261112140000_client_membership_scope.sql',
    'utf8',
  );
  assert.match(sql, /^--[\s\S]*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 3);
  assert.doesNotMatch(
    sql,
    /\b(?:DROP|TRUNCATE|GRANT|REVOKE|ALTER TABLE|INSERT INTO|UPDATE public|DELETE FROM)\b/,
  );
  for (const name of ['has_permission', 'current_client_id', 'current_organization_ids'])
    assert(sql.includes('FUNCTION public.' + name));
  assert.match(sql, /u\.status = 'ACTIVE' AND u\.deleted_at IS NULL/);
  assert.match(sql, /c\.organization_id = om\.organization_id AND c\.deleted_at IS NULL/);
  assert.match(sql, /rk\.key = 'client'/);
  assert.match(sql, /has_function_privilege\('anon'/);
  for (const key of Object.keys(initialRolePermissions).filter((k) => k !== 'client'))
    assert(sql.includes("'" + key + "'"));
});

test('Storage matrix materializes 72 distinct, unexecuted cells without leaking actor credentials', () => {
  const actors = [
    'administrator',
    'lawyer',
    'secretary',
    'finance',
    'client',
    'anon',
    'foreign',
    'suspended',
  ].map((role) => [
    role,
    role === 'anon'
      ? null
      : { profileId: 'synthetic-' + role, org: 'synthetic-org', token: 'DO_NOT_RECORD_TOKEN' },
  ]);
  const fixture = {
    documentId: 'document',
    clientId: 'client',
    versionId: 'version',
    storageKey: 'synthetic/key',
  };
  const cells = plannedStorageCells(actors, fixture);
  assert.equal(cells.length, 72);
  assert.equal(new Set(cells.map((c) => c.id)).size, 72);
  assert(cells.every((c) => c.status === 'NOT_EXECUTED' && c.requests.length === 0));
  assert(!JSON.stringify(cells).includes('DO_NOT_RECORD_TOKEN'));
  assert.throws(() => plannedStorageCells(actors.slice(1), fixture));
});

test('RLS direct-write probe targets an existing linked object already read by the same user', () => {
  const script = readFileSync('tools/supabase/rls.test.mjs', 'utf8');
  const metadata = script.indexOf('await database.documentVersion.create(');
  const readable = script.indexOf('const downloaded = await fetch(ownSignedUrl.data.signedUrl)');
  const attempt = script.indexOf('const uploadA = await lawyerA.storage');
  assert(metadata >= 0 && readable > metadata && attempt > readable);
  assert(script.slice(readable, attempt).includes('private download hash mismatch'));
  assert(script.slice(attempt).includes('SYNTHETIC FORBIDDEN CHANGE'));
  assert(script.slice(attempt).includes('direct attempt changed fixture bytes'));
});

for (const [name, runner] of [
  ['client scope', runClientScopeIntegrity],
  ['Storage matrix', runDocumentStorageMatrix],
  ['Storage catalog', ({ env, db }) => inspectStorageCatalog(env, db)],
]) {
  for (const override of [
    { NEXT_PUBLIC_SUPABASE_URL: 'https://shared.invalid' },
    { SUPABASE_ACCESS_TOKEN: 'synthetic-management-credential' },
    { SUPABASE_ENVIRONMENT: 'production' },
  ])
    test(
      name +
        ' refuses unsafe configuration before touching database or Storage: ' +
        Object.keys(override)[0],
      async () => {
        let touches = 0;
        const db = new Proxy(
          {},
          {
            get() {
              touches++;
              throw new Error('UNEXPECTED_DATABASE_ACCESS');
            },
          },
        );
        const env = {
          GITHUB_ACTIONS: 'true',
          RUNNER_OS: 'Linux',
          LIVIO_IDENTITY_INTEGRATION: 'disposable',
          NODE_ENV: 'test',
          SUPABASE_LOCAL: 'true',
          SUPABASE_ENVIRONMENT: 'test',
          NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/v1',
          NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
          DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:54322/postgres',
          SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-only',
          CLAMAV_HOST: '127.0.0.1',
          CLAMAV_PORT: '13310',
          RUNNER_TEMP: process.cwd(),
          LIVIO_QA_OUTPUT: process.cwd() + '/synthetic-evidence',
          ...override,
        };
        await assert.rejects(
          runner({ env, db }),
          /explicit disposable|Non-test|External endpoint|External management|Shared or linked/,
        );
        assert.equal(touches, 0);
      },
    );
}

test('observed structured managed-object denial is recognized without accepting generic 400 responses', () => {
  const body = {
    statusCode: '403',
    code: 'AccessDenied',
    error: 'Unauthorized',
    message: 'Server managed object',
  };
  assert.equal(storageDenial(400, body), 'AUTHORIZATION_DENIED');
  for (const changed of [
    { ...body, statusCode: '500' },
    { ...body, code: 'Other' },
    { ...body, error: 'Other' },
    { ...body, message: 'Object not found' },
  ])
    assert.equal(storageDenial(400, changed), 'HARNESS_DOMAIN_OR_INFRA_FAILURE');
  assert.equal(storageDenial(200, body), 'ACCEPTED_OR_AMBIGUOUS_NOOP');
  assert.equal(storageDenial(503, body), 'HARNESS_DOMAIN_OR_INFRA_FAILURE');
});
test('structured denial still cannot approve invalid fixtures, JWTs, missing controls or changed bytes', () => {
  const kind = storageDenial(400, {
    statusCode: '403',
    code: 'AccessDenied',
    error: 'Unauthorized',
    message: 'Server managed object',
  });
  const proof = {
    operationSent: true,
    writeBarrier: true,
    providerIdentified: true,
    fixtureValid: true,
    serverExists: true,
    jwtValidated: true,
    unchanged: true,
    positiveControl: true,
    response: { kind, http: 400 },
  };
  assert.equal(diagnoseMatrixAttempt(proof).securityProven, true);
  for (const changed of [
    { operationSent: false },
    { writeBarrier: false },
    { providerIdentified: false },
    { fixtureValid: false },
    { serverExists: false },
    { jwtValidated: false },
    { unchanged: false },
    { unchanged: null },
    { positiveControl: false },
  ])
    assert.equal(diagnoseMatrixAttempt({ ...proof, ...changed }).securityProven, false);
});

test('generic 400 authorization words never replace the structured provider contract', () => {
  for (const message of [
    'Unauthorized',
    'access denied',
    'permission denied',
    'Server managed object',
  ])
    assert.notEqual(storageDenial(400, { message }), 'AUTHORIZATION_DENIED');
});
test('overwrite authorization proof requires exact INSERT and UPDATE restrictive policies and ordinary role', () => {
  const policies = ['insert', 'update'].map((op) => ({
    policyname: 'document_api_' + op + '_boundary',
    cmd: op.toUpperCase(),
    permissive: 'RESTRICTIVE',
    roles: '{anon,authenticated}',
    qual: "(bucket_id <> 'legal-documents'::text)",
    with_check: "(bucket_id <> 'legal-documents'::text)",
  }));
  const proof = {
    session: {
      role: 'anon',
      profile_id: null,
      rolsuper: false,
      rolbypassrls: false,
      owns_table: false,
      can_assume_privileged: false,
      relrowsecurity: true,
    },
    predicate: { allowed: false },
    barriers: {},
  };
  for (const op of ['upsert', 'signed-upload', 'insert', 'update'])
    assert.equal(storageWriteBarrier(op, proof, { policies }, null), true);
  assert.equal(
    storageWriteBarrier('upsert', proof, { policies: policies.slice(0, 1) }, null),
    false,
  );
  assert.equal(
    storageWriteBarrier('upsert', { ...proof, predicate: { allowed: true } }, { policies }, null),
    false,
  );
  assert.equal(
    storageWriteBarrier(
      'upsert',
      { ...proof, session: { ...proof.session, rolbypassrls: true } },
      { policies },
      null,
    ),
    false,
  );
});
