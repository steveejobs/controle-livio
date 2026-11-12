import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateIdentityEnvironment } from './identity-environment.mjs';
const env = {
  GITHUB_ACTIONS: 'true',
  RUNNER_OS: 'Linux',
  LIVIO_IDENTITY_INTEGRATION: 'disposable',
  NODE_ENV: 'test',
  SUPABASE_LOCAL: 'true',
  SUPABASE_ENVIRONMENT: 'test',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/v1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  DATABASE_URL: 'postgresql://ci:ci@127.0.0.1:54322/postgres',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-local',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-local',
  CLAMAV_HOST: '127.0.0.1',
  CLAMAV_PORT: '13310',
  RUNNER_TEMP: process.cwd(),
  LIVIO_QA_OUTPUT: process.cwd() + '/synthetic-evidence',
};
const opts = { platform: 'linux', exists: () => false };
test('identity guard accepts only explicit local CI settings', () =>
  assert.doesNotThrow(() => validateIdentityEnvironment(env, '.', opts)));
for (const [key, value] of [
  ['DATABASE_URL', 'postgresql://ci:ci@hosted.invalid/postgres'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'https://hosted.invalid'],
  ['NEXT_PUBLIC_API_URL', 'https://preview.invalid'],
  ['SUPABASE_ACCESS_TOKEN', 'synthetic-external'],
  ['NODE_ENV', 'production'],
  ['CLAMAV_HOST', 'external.invalid'],
  ['LIVIO_IDENTITY_INTEGRATION', undefined],
])
  test('identity guard rejects ' + key, () =>
    assert.throws(() => validateIdentityEnvironment({ ...env, [key]: value }, '.', opts)),
  );
test('identity guard rejects linked env files and the local Windows host', () => {
  assert.throws(() =>
    validateIdentityEnvironment(env, '.', {
      ...opts,
      exists: (p) => p.replaceAll('\\', '/').endsWith('apps/api/.env.test.local'),
    }),
  );
  assert.throws(() => validateIdentityEnvironment(env, '.', { ...opts, exists: () => true }));
  assert.throws(() => validateIdentityEnvironment(env, '.', { ...opts, platform: 'win32' }));
});
