import { appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const serviceExcludes = [
  'studio',
  'imgproxy',
  'mailpit',
  'realtime',
  'edge-runtime',
  'logflare',
  'vector',
  'postgres-meta',
].join(',');

function fail(message) {
  console.error(`Integração local bloqueada: ${message}`);
  process.exit(1);
}

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Linux') {
  fail('este inicializador só pode executar no runner Linux do GitHub Actions.');
}

if (!process.env.GITHUB_ENV) fail('GITHUB_ENV não está disponível.');
if (process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_DB_PASSWORD) {
  fail('o job recebeu credenciais Supabase externas; remova-as antes de executar.');
}
if (existsSync('supabase/.temp/project-ref')) {
  fail('há um vínculo local com projeto Supabase; o job exige uma stack sem vínculo cloud.');
}

function runSupabase(args, capture = false) {
  const result = spawnSync('npx', ['supabase', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    // CLI output is deliberately withheld because `start` can print generated local keys.
    fail(`npx supabase ${args[0]} terminou com código ${result.status ?? 'desconhecido'}.`);
  }
  return capture ? `${result.stdout ?? ''}${result.stderr ?? ''}` : '';
}

runSupabase(['start', '--exclude', serviceExcludes]);
const status = runSupabase(['status', '--output', 'env'], true);
const values = new Map();
for (const line of status.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (!match) continue;
  const [, key, encoded] = match;
  let value = encoded;
  if (value.startsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      fail(`a saída segura do Supabase não pôde ser interpretada (${key}).`);
    }
  }
  values.set(key, value);
}

const apiUrl = values.get('API_URL');
const databaseUrlText = values.get('DB_URL');
const anonKey = values.get('ANON_KEY');
const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
if (!apiUrl || !databaseUrlText || !anonKey || !serviceRoleKey) {
  fail('o Supabase local não retornou API_URL, DB_URL e chaves necessárias.');
}

const apiUrlValue = new URL(apiUrl);
const databaseUrl = new URL(databaseUrlText);
if (
  !loopbackHosts.has(apiUrlValue.hostname) ||
  !loopbackHosts.has(databaseUrl.hostname) ||
  apiUrlValue.protocol !== 'http:' ||
  !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)
) {
  fail('API e banco precisam apontar para loopback em HTTP/PostgreSQL local.');
}
if (anonKey.length < 20 || serviceRoleKey.length < 20) {
  fail('as chaves temporárias locais retornadas pelo Supabase são inválidas.');
}

databaseUrl.searchParams.set('schema', 'public');
databaseUrl.searchParams.set('connection_limit', '4');
databaseUrl.searchParams.set('pool_timeout', '10');

const environment = {
  API_PORT: '3001',
  CORS_ORIGINS: 'http://127.0.0.1:3010',
  DATABASE_URL: databaseUrl.toString(),
  LOG_LEVEL: 'warn',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/v1',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  NEXT_PUBLIC_SUPABASE_URL: apiUrl,
  NEXT_TELEMETRY_DISABLED: '1',
  NODE_ENV: 'test',
  QA_TIMINGS: 'true',
  STORAGE_BUCKET: 'legal-documents',
  SUPABASE_ANON_KEY: anonKey,
  SUPABASE_AUTH_REDIRECT_URL: 'http://127.0.0.1:3010/auth/confirm',
  SUPABASE_ENVIRONMENT: 'test',
  SUPABASE_LOCAL: 'true',
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  SUPABASE_URL: apiUrl,
};

for (const key of [
  'DATABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]) {
  console.log(`::add-mask::${environment[key]}`);
}

for (const [key, value] of Object.entries(environment)) {
  if (/[\r\n]/.test(value)) fail(`valor inválido para ${key}.`);
  appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`, { encoding: 'utf8' });
}

// Explicit --local avoids the linked/remote database target. This recreates only the runner's
// disposable Postgres and applies every versioned migration plus the synthetic seed.
runSupabase(['--yes', 'db', 'reset', '--local']);
console.log('Supabase local pronto: Postgres, Auth, PostgREST e Storage em loopback.');
console.log('Migrations versionadas e seed sintético aplicados somente com --local.');
console.log('Serviços de e-mail, realtime, Studio e serviços não usados ficaram desligados.');
