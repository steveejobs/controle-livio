import { existsSync, readFileSync } from 'node:fs';

function loadLocalEnvironment() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function fail(message) {
  throw new Error(`Operacao Supabase bloqueada: ${message}`);
}

function isLocalDatabase(rawUrl) {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

loadLocalEnvironment();
const action = process.argv[2];
const environment = process.env.SUPABASE_ENVIRONMENT;
const projectRef = process.env.SUPABASE_PROJECT_REF;
const confirmation = process.env.CONFIRM_SUPABASE_PROJECT_REF;
const databaseUrl = process.env.DATABASE_URL ?? '';

if (!['development', 'test', 'staging', 'production'].includes(environment ?? '')) {
  fail('SUPABASE_ENVIRONMENT deve ser explicito');
}

if (action === 'local-reset') {
  if (!['development', 'test'].includes(environment)) fail('reset local exige development/test');
  if (process.env.SUPABASE_LOCAL !== 'true') fail('SUPABASE_LOCAL=true e obrigatorio');
  if (databaseUrl && !isLocalDatabase(databaseUrl))
    fail('DATABASE_URL nao aponta para a stack local');
} else {
  if (!projectRef || projectRef.includes('example')) fail('SUPABASE_PROJECT_REF invalido');
  if (projectRef !== confirmation) fail('confirmacao do project ref nao confere');
  if (!databaseUrl.includes('supabase') || !databaseUrl.includes(projectRef)) {
    fail('DATABASE_URL nao corresponde ao projeto Supabase confirmado');
  }
  if (action === 'seed') {
    if (!['development', 'test'].includes(environment)) fail('seed exige development/test');
    if (process.env.ALLOW_DEVELOPMENT_SEED !== 'true') fail('seed nao foi autorizado');
  }
  if (action === 'remote-migrate' && environment === 'production') {
    if (process.env.ALLOW_PRODUCTION_MIGRATION !== 'true') {
      fail('migration de producao exige autorizacao adicional');
    }
  }
  if (action === 'database-tool' && environment === 'production') {
    fail('Prisma Studio e bloqueado em producao');
  }
}

process.stdout.write(`Safeguard Supabase aprovado para ${action}.\n`);
