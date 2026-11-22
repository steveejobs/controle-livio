import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyProductionEnvironment } from './verify-environment.mjs';

const config = {
  NODE_ENV: 'production',
  SUPABASE_ENVIRONMENT: 'staging',
  SUPABASE_LOCAL: 'false',
  SUPABASE_PROJECT_REF: 'syntheticproject123',
  CONFIRM_SUPABASE_PROJECT_REF: 'syntheticproject123',
  DATABASE_URL:
    'postgresql://postgres.syntheticproject123:private-value@aws-0-us-east-2.pooler.supabase.com:6543/postgres',
  SUPABASE_URL: 'https://syntheticproject123.supabase.co',
  SUPABASE_ANON_KEY: 'synthetic-publishable-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-placeholder',
  SUPABASE_AUTH_REDIRECT_URL: 'https://app.example.test/auth/confirm',
  CORS_ORIGINS: 'https://app.example.test',
  STORAGE_BUCKET: 'legal-documents',
  CLAMAV_GATEWAY_URL: 'https://scanner.example.test/scan',
  CLAMAV_GATEWAY_TOKEN: 'synthetic-scanner-token-with-at-least-32-characters',
};

test('hosted configuration with an authenticated scanner passes before publication', () => {
  assert.deepEqual(verifyProductionEnvironment(config), { result: 'PASS', issues: [] });
});

test('missing scanner stops the deployment build instead of publishing a startup failure', () => {
  const { CLAMAV_GATEWAY_URL, CLAMAV_GATEWAY_TOKEN, ...missing } = config;
  assert(CLAMAV_GATEWAY_URL && CLAMAV_GATEWAY_TOKEN);
  const result = verifyProductionEnvironment(missing);
  assert.equal(result.result, 'FAIL');
  assert(result.issues.some((issue) => issue.path[0] === 'CLAMAV_HOST'));
});

test('local test bypass is never a valid production deployment', () => {
  const result = verifyProductionEnvironment({
    ...config,
    NODE_ENV: 'test',
    SUPABASE_ENVIRONMENT: 'test',
    SUPABASE_LOCAL: 'true',
  });
  assert.equal(result.result, 'FAIL');
  assert(result.issues.some((issue) => issue.code === 'production_required'));
});

test('invalid credential-bearing URLs cannot leak values through validation output', () => {
  const secret = 'private-value-that-must-never-be-logged';
  const result = verifyProductionEnvironment({ ...config, DATABASE_URL: secret });
  assert.equal(result.result, 'FAIL');
  assert(!JSON.stringify(result).includes(secret));
});
