import { validateIdentityEnvironment } from '../../qa/identity-environment.mjs';
export function validateRecoveryEnvironment(env = process.env, root = process.cwd(), options = {}) {
  validateIdentityEnvironment(env, root, options);
  if (
    env.LIVIO_STORAGE_RECOVERY !== 'disposable-new-stack' ||
    env.STORAGE_RECOVERY_DISPATCH_ENABLED !== 'true' ||
    env.STORAGE_RECOVERY_DELETE_ENABLED !== 'true'
  )
    throw new Error('Explicit disposable recovery rehearsal required');
  if (
    env.SUPABASE_URL !== env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_ANON_KEY !== env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
    throw new Error('Mismatched local service identity');
  if (env.QA_TIMINGS && env.QA_TIMINGS !== 'false')
    throw new Error('Raw SQL timing is disabled in recovery evidence');
}

export function recoveryRunnerEnvironment(input = process.env, root = process.cwd(), options = {}) {
  validateRecoveryEnvironment(input, root, options);
  const keys = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'TZ',
    'CI',
    'GITHUB_ACTIONS',
    'GITHUB_RUN_ID',
    'GITHUB_SHA',
    'GITHUB_REPOSITORY',
    'RUNNER_OS',
    'RUNNER_TEMP',
    'RUNNER_TOOL_CACHE',
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NODE_ENV',
    'SUPABASE_LOCAL',
    'SUPABASE_ENVIRONMENT',
    'CLAMAV_HOST',
    'CLAMAV_PORT',
    'CLAMAV_TIMEOUT_MS',
    'LIVIO_IDENTITY_INTEGRATION',
    'LIVIO_STORAGE_RECOVERY',
    'LIVIO_RECOVERY_PROJECT',
    'LIVIO_RECOVERY_CLUSTER',
    'LIVIO_QA_OUTPUT',
    'STORAGE_RECOVERY_DISPATCH_ENABLED',
    'STORAGE_RECOVERY_DELETE_ENABLED',
  ];
  return {
    ...Object.fromEntries(
      keys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]),
    ),
    QA_TIMINGS: 'false',
    API_PORT: '3001',
    LOG_LEVEL: 'warn',
    STORAGE_BUCKET: 'legal-documents',
    NEXT_TELEMETRY_DISABLED: '1',
    CORS_ORIGINS: 'http://127.0.0.1:3010',
    SUPABASE_AUTH_REDIRECT_URL: 'http://127.0.0.1:3010/auth/confirm',
  };
}
