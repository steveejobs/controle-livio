import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { validateFinancialEnvironment } from './financial-integrity-support.mjs';

const safeKeys = [
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
  'RUNNER_OS',
  'RUNNER_TEMP',
  'RUNNER_TOOL_CACHE',
];
const localKeys = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ENVIRONMENT',
  'SUPABASE_LOCAL',
  'NODE_ENV',
  'CLAMAV_HOST',
  'CLAMAV_PORT',
  'CLAMAV_TIMEOUT_MS',
];

export function validateFinancialRunnerHost(
  input,
  root,
  platform = process.platform,
  exists = existsSync,
) {
  if (input.GITHUB_ACTIONS !== 'true' || input.RUNNER_OS !== 'Linux' || platform !== 'linux')
    throw new Error('Financial runner requires the disposable GitHub Linux host.');
  if (!input.RUNNER_TEMP || !/^\d+$/.test(input.GITHUB_RUN_ID ?? ''))
    throw new Error('Missing disposable runner identity.');
  if (exists(resolve(root, 'supabase/.temp/project-ref')))
    throw new Error('Linked Supabase project refused.');
  if (input.SUPABASE_ACCESS_TOKEN || input.SUPABASE_DB_PASSWORD)
    throw new Error('External Supabase credentials refused.');
  for (const directory of ['', 'apps/api', 'apps/web'])
    for (const suffix of [
      '',
      '.local',
      '.test',
      '.test.local',
      '.production',
      '.production.local',
      '.development',
      '.development.local',
    ])
      if (exists(resolve(root, directory, `.env${suffix}`)))
        throw new Error('Shared environment files refused before dependency installation.');
  for (const key of [
    'DATABASE_URL',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_API_URL',
  ]) {
    if (input[key] && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(input[key]).hostname))
      throw new Error('External service URL refused.');
  }
}

export function financialRunnerConfiguration(
  input,
  root,
  platform = process.platform,
  exists = existsSync,
) {
  validateFinancialRunnerHost(input, root, platform, exists);
  const output = resolve(input.RUNNER_TEMP, 'livio-financial-security');
  if (input.LIVIO_QA_OUTPUT && resolve(input.LIVIO_QA_OUTPUT) !== output)
    throw new Error('Financial evidence must stay in this runner temporary directory.');
  // Check the unfiltered environment first: dropping external credentials is not authorization.
  validateFinancialEnvironment({ ...input, LIVIO_QA_OUTPUT: output }, root, exists);
  for (const key of ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    const url = new URL(input[key]);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Auth/Storage must use a credential-free loopback URL.');
  }
  if (
    new URL(input.SUPABASE_URL).origin !== new URL(input.NEXT_PUBLIC_SUPABASE_URL).origin ||
    input.NEXT_PUBLIC_API_URL !== 'http://127.0.0.1:3001/v1' ||
    !input.SUPABASE_ANON_KEY ||
    input.SUPABASE_ANON_KEY !== input.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
    throw new Error('Disposable API/Auth identities do not match.');
  const picked = Object.fromEntries(
    [...safeKeys, ...localKeys].flatMap((key) =>
      typeof input[key] === 'string' ? [[key, input[key]]] : [],
    ),
  );
  return {
    output,
    harness: {
      ...picked,
      LIVIO_QA_OUTPUT: output,
      LIVIO_FINANCIAL_INTEGRATION: 'disposable',
      GITHUB_RUN_ID: input.GITHUB_RUN_ID,
      LIVIO_CLAMAV_INTEGRATION_FAILURES: 'true',
    },
    api: {
      ...picked,
      API_PORT: '3001',
      CORS_ORIGINS: 'http://127.0.0.1:3010',
      LOG_LEVEL: 'warn',
      QA_TIMINGS: 'true',
      STORAGE_BUCKET: 'legal-documents',
      SUPABASE_AUTH_REDIRECT_URL: 'http://127.0.0.1:3010/auth/confirm',
      // Same existing API contract: scanner bypass is disabled; all services remain local.
      SUPABASE_ENVIRONMENT: 'staging',
    },
  };
}

export function sanitizeFinancialLog(text, env) {
  for (const key of [
    'DATABASE_URL',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ])
    if (env[key]) text = text.split(env[key]).join('[REDACTED]');
  return text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED DB URL]')
    .replace(/([?&](?:token|signature|apikey|access_token)=)[^&\s"']+/gi, '$1[REDACTED]');
}

function awaitClose(child, timeoutMs) {
  return new Promise((resolvePromise) => {
    const finish = (value) => {
      clearTimeout(timer);
      child.off('close', closed);
      resolvePromise(value);
    };
    const closed = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('close', closed);
    if (child.exitCode !== null || child.signalCode) finish(true);
  });
}

export async function stopOwnedApi(child, graceMs = 8000) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  const closed = awaitClose(child, graceMs);
  child.kill('SIGTERM');
  if (await closed) return;
  const killed = awaitClose(child, 2000);
  child.kill('SIGKILL');
  if (!(await killed)) throw new Error('Owned API child did not stop.');
}

export async function withFinancialApi(configuration, root, action, options = {}) {
  const child = (options.spawn ?? spawn)(process.execPath, [join(root, 'apps/api/dist/main.js')], {
    cwd: root,
    env: configuration.api,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '',
    spawnError,
    logOmitted = false;
  const collect = (chunk) => {
    if (logOmitted) return;
    log += chunk.toString();
    if (log.length > 2 * 1024 * 1024) {
      log = '[API log omitted after size limit; financial JSON evidence is retained.]';
      logOmitted = true;
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', (error) => {
    spawnError = error;
  });
  try {
    const deadline = Date.now() + (options.readyTimeoutMs ?? 90_000);
    let ready = false;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode)
        throw new Error('API child failed before readiness.');
      try {
        const response = await (options.fetch ?? fetch)('http://127.0.0.1:3001/v1/health/ready', {
          signal: AbortSignal.timeout(3000),
        });
        ready = response.status === 200;
        await response.body?.cancel();
        if (ready) break;
      } catch {
        /* bounded readiness; it never turns a connection error into success */
      }
      await delay(options.pollMs ?? 500);
    }
    if (!ready) throw new Error('API readiness deadline exceeded.');
    if (spawnError || child.exitCode !== null || child.signalCode)
      throw new Error('API child exited at readiness.');
    return await action();
  } finally {
    try {
      await stopOwnedApi(child, options.graceMs);
      options.onStopped?.();
    } finally {
      writeFileSync(
        join(configuration.output, 'financial-api.log'),
        sanitizeFinancialLog(log, configuration.api),
      );
    }
  }
}

async function inspectDisposableDatabase(env, root) {
  const require = createRequire(join(root, 'package.json'));
  const { PrismaClient } = require('@prisma/client');
  const database = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const [identity] = await database.$queryRawUnsafe(`SELECT current_user::text AS role,
      session_user::text AS session_role,current_database()::text AS database,
      current_setting('server_version') AS postgres_version,r.rolsuper,r.rolbypassrls
      FROM pg_roles r WHERE r.rolname=current_user`);
    const migrations = await database.$queryRawUnsafe(
      'SELECT version::text FROM supabase_migrations.schema_migrations ORDER BY version',
    );
    if (!migrations.some((row) => row.version === '20261111120000'))
      throw new Error('DEF-008 migration was not applied to the disposable database.');
    if (!identity || ['anon', 'authenticated'].includes(identity.role))
      throw new Error('API database identity does not match the existing server contract.');
    return { identity, appliedMigrations: migrations.map((row) => row.version) };
  } finally {
    await database.$disconnect();
  }
}

async function executeHarness(root, env) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(root, 'tools/qa/financial-integrity-ci.mjs')], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 11 * 60_000,
    });
    let text = '',
      omitted = false;
    const collect = (chunk) => {
      if (omitted) return;
      text += chunk.toString();
      if (text.length > 512 * 1024) {
        text = '[Harness output omitted after size limit; financial JSON evidence is retained.]';
        omitted = true;
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const safe = sanitizeFinancialLog(text, env);
      if (safe.trim()) console.log(safe);
      if (code === 0) resolvePromise();
      else reject(new Error(`Existing financial harness failed (${code ?? signal}).`));
    });
  });
}

export async function runFinancialRunner(input = process.env) {
  const root = process.cwd();
  const configuration = financialRunnerConfiguration(input, root);
  if (!process.version.startsWith('v24.')) throw new Error('Node 24 required.');
  if (existsSync(configuration.output))
    throw new Error('Previous financial evidence directory refused.');
  mkdirSync(configuration.output, { recursive: true });
  const summary = {
    status: 'FAIL',
    node: process.version,
    scope: 'disposable host/API; no browser',
  };
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    configuration.harness.LIVIO_AUDIT_SHA = sha;
    summary.sha = sha;
    summary.database = await inspectDisposableDatabase(configuration.harness, root);
    await withFinancialApi(
      configuration,
      root,
      async () => {
        summary.apiReady = true;
        await executeHarness(root, configuration.harness);
      },
      {
        onStopped: () => {
          summary.apiStopped = true;
        },
      },
    );
    summary.status = 'PASS';
  } catch (error) {
    summary.error = sanitizeFinancialLog(
      error instanceof Error ? error.message : 'Financial runner failed.',
      input,
    );
    throw error;
  } finally {
    writeFileSync(
      join(configuration.output, 'financial-runner-summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const execute = async () => {
    if (process.argv.length === 3 && process.argv[2] === '--preflight') {
      validateFinancialRunnerHost(process.env, process.cwd());
      console.log('Financial host preflight PASS; no dependencies, database or services started.');
    } else if (process.argv.length === 2) await runFinancialRunner();
    else throw new Error('Unsupported financial runner arguments.');
  };
  execute().catch(() => {
    console.error(
      'Independent financial runner failed; inspect sanitized evidence if preflight completed.',
    );
    process.exitCode = 1;
  });
}
