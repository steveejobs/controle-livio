import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { validateRecoveryEnvironment, recoveryRunnerEnvironment } from './environment.mjs';
import {
  assertRecoveryArchive,
  assertRecoveryOwners,
  recoveryRestoreInventory,
} from './restore-inventory.mjs';

const env = {
  GITHUB_ACTIONS: 'true',
  RUNNER_OS: 'Linux',
  LIVIO_IDENTITY_INTEGRATION: 'disposable',
  LIVIO_STORAGE_RECOVERY: 'disposable-new-stack',
  NODE_ENV: 'test',
  SUPABASE_LOCAL: 'true',
  SUPABASE_ENVIRONMENT: 'test',
  STORAGE_RECOVERY_DISPATCH_ENABLED: 'true',
  STORAGE_RECOVERY_DELETE_ENABLED: 'true',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/v1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:54322/postgres',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key',
  SUPABASE_ANON_KEY: 'synthetic-anon-key',
  CLAMAV_HOST: '127.0.0.1',
  CLAMAV_PORT: '13310',
  RUNNER_TEMP: '/tmp/recovery-test',
  LIVIO_QA_OUTPUT: '/tmp/recovery-test/evidence',
  QA_TIMINGS: 'false',
};
const options = { platform: 'linux', exists: () => false };
test('API and child environment exclude external account and inherited scheduler credentials', () => {
  const filtered = recoveryRunnerEnvironment(
    {
      ...env,
      GITHUB_TOKEN: 'SENSITIVE_MISMATCH_SENTINEL',
      ACTIONS_RUNTIME_TOKEN: 'SENSITIVE_MISMATCH_SENTINEL',
      CRON_SECRET: 'SENSITIVE_MISMATCH_SENTINEL',
    },
    '/synthetic',
    options,
  );
  assert.equal(filtered.GITHUB_TOKEN, undefined);
  assert.equal(filtered.ACTIONS_RUNTIME_TOKEN, undefined);
  assert.equal(filtered.CRON_SECRET, undefined);
  assert.equal(filtered.QA_TIMINGS, 'false');
});
test('recovery guard accepts only the explicit synthetic disposable rehearsal', () => {
  validateRecoveryEnvironment(env, '/synthetic', options);
});
for (const [key, value] of [
  ['LIVIO_STORAGE_RECOVERY', ''],
  ['STORAGE_RECOVERY_DISPATCH_ENABLED', 'false'],
  ['STORAGE_RECOVERY_DELETE_ENABLED', 'false'],
  ['SUPABASE_URL', 'https://external.invalid'],
  ['SUPABASE_ANON_KEY', 'SENSITIVE_MISMATCH_SENTINEL'],
  ['QA_TIMINGS', 'true'],
  ['SUPABASE_ACCESS_TOKEN', 'SENSITIVE_MISMATCH_SENTINEL'],
  ['LIVIO_QA_OUTPUT', '/outside'],
]) {
  test('recovery guard rejects ' + key + ' without echoing credentials', () => {
    assert.throws(
      () => validateRecoveryEnvironment({ ...env, [key]: value }, '/synthetic', options),
      (error) => !error.message.includes('SENSITIVE_MISMATCH_SENTINEL'),
    );
  });
}
test('a local Windows host cannot execute the real recovery harness', () => {
  assert.throws(() =>
    validateRecoveryEnvironment(env, '/synthetic', { ...options, platform: 'win32' }),
  );
});
test('linked checkouts and shared env files are rejected', () => {
  assert.throws(() =>
    validateRecoveryEnvironment(env, '/synthetic', {
      ...options,
      exists: (path) => path.endsWith('.env'),
    }),
  );
});
test('restore owner inventory uses exact identities and rejects a same-count substitution', () => {
  const owners = recoveryRestoreInventory.owners.map((name) => name + ':postgres');
  assertRecoveryOwners(owners);
  const replaced = [...owners];
  replaced[0] = replaced[0].replace('configuration', 'unreviewed');
  assert.throws(() => assertRecoveryOwners(replaced));
});
const privateCatalogFixture = () =>
  recoveryRestoreInventory.aclNames
    .filter((n) => n.startsWith('TABLE '))
    .map((n) => ({
      name: n.slice(6),
      rls: true,
      forceRls: true,
      ownerOnlyColumnAcl: true,
      serverAccess: true,
      owner: 'postgres',
      ownerOnlyAcl: true,
      noBrowserPrivileges: true,
    }));
const functionCatalogFixture = () =>
  recoveryRestoreInventory.aclNames
    .filter((n) => n.startsWith('FUNCTION '))
    .map((n) => ({
      name: n.slice(9),
      owner: 'postgres',
      securityDefiner: true,
      config: ['search_path=pg_catalog'],
      noBrowserExecute: true,
      serverExecute: true,
    }));
test('restore ACL inventory rejects unexpected execution/table entries', () => {
  const entries = recoveryRestoreInventory.aclNames.map((name) => ({
    description: 'ACL',
    namespace: 'public',
    name,
  }));
  assert.equal(
    assertRecoveryArchive(entries, privateCatalogFixture(), functionCatalogFixture()),
    10,
  );
  const changed = entries.map((entry, index) =>
    index ? entry : { ...entry, name: 'FUNCTION storage_recovery_arbitrary_delete()' },
  );
  assert.throws(() =>
    assertRecoveryArchive(changed, privateCatalogFixture(), functionCatalogFixture()),
  );
});
test('58 contract IDs remain individually enumerated; registry is not an execution result', () => {
  const cases = JSON.parse(readFileSync(new URL('./contracts.json', import.meta.url), 'utf8'));
  assert.equal(cases.length, 58);
  assert.equal(new Set(cases.map((c) => c.id)).size, 58);
  for (let writer = 1; writer <= 5; writer++)
    for (let boundary = 1; boundary <= 8; boundary++)
      assert.ok(cases.some((c) => c.id === `REC-W0${writer}-F0${boundary}`));
  for (let x = 1; x <= 18; x++)
    assert.ok(cases.some((c) => c.id === `REC-X${String(x).padStart(2, '0')}`));
  assert.ok(cases.every((c) => !('result' in c)));
});

test('observed six-function archive requires independent full private-table proof', () => {
  const entries = recoveryRestoreInventory.aclNames
    .filter((n) => n.startsWith('FUNCTION '))
    .map((name) => ({ description: 'ACL', namespace: 'public', name }));
  assert.equal(
    assertRecoveryArchive(entries, privateCatalogFixture(), functionCatalogFixture()),
    6,
  );
  assert.throws(() => assertRecoveryArchive(entries));
  for (const field of [
    'rls',
    'forceRls',
    'ownerOnlyAcl',
    'ownerOnlyColumnAcl',
    'noBrowserPrivileges',
    'serverAccess',
  ]) {
    const rows = privateCatalogFixture();
    rows[0][field] = false;
    assert.throws(() => assertRecoveryArchive(entries, rows, functionCatalogFixture()));
  }
  const rows = privateCatalogFixture();
  rows[0].owner = 'authenticated';
  assert.throws(() => assertRecoveryArchive(entries, rows, functionCatalogFixture()));
  assert.throws(() =>
    assertRecoveryArchive(entries.slice(1), privateCatalogFixture(), functionCatalogFixture()),
  );
  assert.throws(() =>
    assertRecoveryArchive(
      [
        ...entries,
        { description: 'ACL', namespace: 'public', name: 'TABLE storage_recovery_unreviewed' },
      ],
      privateCatalogFixture(),
      functionCatalogFixture(),
    ),
  );
});

test('restore rejects function execute, search_path and security mode drift', () => {
  const entries = recoveryRestoreInventory.aclNames
    .filter((n) => n.startsWith('FUNCTION '))
    .map((name) => ({ description: 'ACL', namespace: 'public', name }));
  for (const [key, value] of [
    ['noBrowserExecute', false],
    ['serverExecute', false],
    ['securityDefiner', false],
    ['config', ['search_path=public']],
  ]) {
    const f = functionCatalogFixture();
    f[0][key] = value;
    assert.throws(() => assertRecoveryArchive(entries, privateCatalogFixture(), f));
  }
});
