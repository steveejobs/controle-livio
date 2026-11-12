import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { storageDenial, storageOperations } from './document-storage-matrix.mjs';
import { collectDiagnostics, failureFacts } from './supabase-start-diagnostics.mjs';

const require = createRequire(import.meta.url);
const { initialRolePermissions } = require('@livio/shared');
const yaml = require('js-yaml');
const file = 'supabase/migrations/20261112120000_document_storage_api_write_boundary.sql';
const sql = readFileSync(file, 'utf8');
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
    storageDenial(403, { message: 'new row violates row-level security policy' }),
    'AUTHORIZATION_DENIED',
  );
  assert.equal(
    storageDenial(400, { message: 'permission denied for table documents' }),
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
