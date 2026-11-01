import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'node:crypto';

if (process.argv.includes('--help')) {
  console.log(
    'node --env-file=.env tools/notifications/configure-scheduler.mjs [--runtime-env=path] [--apply --confirm-project=ref] [--activate]',
  );
  process.exit(0);
}
const option = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes('--apply');
const activate = process.argv.includes('--activate');
const projectRef = process.env.SUPABASE_PROJECT_REF;
const supabaseUrl = new URL(process.env.SUPABASE_URL ?? '');
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
const verifiedProductionConnectedProjectRefs = new Set(['ioebcdpyrszokdyaoaqv']);
const knownProductionApiHosts = new Set([
  'controle-livio.vercel.app',
  'controle-livio-web.vercel.app',
]);
// Keep empty until an independent review confirms a dedicated TEST API endpoint.
const approvedTestSchedulerApiHosts = new Set();
assert.ok(
  ['development', 'test', 'staging'].includes(process.env.SUPABASE_ENVIRONMENT),
  'Use apenas desenvolvimento/homologação.',
);
assert.ok(projectRef && projectRef === process.env.CONFIRM_SUPABASE_PROJECT_REF);
assert.equal(supabaseUrl.hostname, `${projectRef}.supabase.co`);
const databaseBelongsToProject =
  databaseUrl.hostname === `db.${projectRef}.supabase.co` ||
  (databaseUrl.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(databaseUrl.username).includes(projectRef));
assert.ok(databaseBelongsToProject, 'DATABASE_URL não identifica o projeto confirmado.');
if (apply)
  assert.equal(option('confirm-project'), projectRef, 'Confirme o projeto antes de configurar.');
if (activate) assert.ok(apply, '--activate exige --apply.');
const prisma = new PrismaClient();
let stage = 'validation';

// pg_net queues are readable to platform roles: send an expiring, single-use HMAC, never the secret.
const command = `WITH dispatch AS (
  SELECT floor(extract(epoch FROM clock_timestamp()))::bigint AS instant,
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'livio_notifications_cron_secret') AS secret
)
SELECT net.http_get(
  url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'livio_notifications_api_url') || '/notifications/dispatch/cron',
  headers := jsonb_build_object('X-Livio-Scheduled-At', dispatch.instant::text,
    'X-Livio-Signature', encode(extensions.hmac(dispatch.instant::text || ':notifications-dispatch', dispatch.secret, 'sha256'), 'hex')),
  timeout_milliseconds := 55000
) FROM dispatch`;

try {
  if (apply) {
    const path = option('runtime-env');
    assert.ok(path, 'Informe o arquivo local de configuração do runtime, excluído do Git.');
    const runtime = parseEnv(readFileSync(path, 'utf8'));
    assert.equal(runtime.SUPABASE_PROJECT_REF, projectRef);
    assert.ok(['development', 'test', 'staging'].includes(runtime.SUPABASE_ENVIRONMENT));
    const configuredApiUrl = option('api-url') ?? runtime.NEXT_PUBLIC_API_URL;
    assert.ok(
      configuredApiUrl?.startsWith('https://'),
      'Informe --api-url com a API HTTPS publicada.',
    );
    const apiUrl = new URL(configuredApiUrl);
    assert.equal(apiUrl.protocol, 'https:');
    assert.equal(apiUrl.username, '', 'A URL da API não pode conter credenciais.');
    assert.equal(apiUrl.password, '', 'A URL da API não pode conter credenciais.');
    assert.equal(apiUrl.search, '', 'A URL da API não pode conter parâmetros secretos.');
    assert.equal(apiUrl.hash, '');
    assert.equal(apiUrl.pathname.replace(/\/$/, ''), '/v1');
    if (runtime.SUPABASE_ENVIRONMENT === 'test') {
      const productionProjectRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF;
      assert.ok(!verifiedProductionConnectedProjectRefs.has(projectRef));
      assert.ok(verifiedProductionConnectedProjectRefs.has(productionProjectRef));
      assert.notEqual(projectRef, productionProjectRef);
      assert.ok(
        approvedTestSchedulerApiHosts.has(apiUrl.hostname),
        'Agendador TEST bloqueado até a API não produtiva ser verificada e allowlisted no código.',
      );
      assert.ok(
        !knownProductionApiHosts.has(apiUrl.hostname),
        'Um banco TEST não pode agendar chamadas para a API de produção.',
      );
      const runtimeApiUrl = new URL(runtime.NEXT_PUBLIC_API_URL);
      assert.equal(runtimeApiUrl.origin, apiUrl.origin);
      assert.equal(runtimeApiUrl.pathname.replace(/\/$/, ''), '/v1');
      assert.equal(new URL(runtime.SUPABASE_URL).hostname, `${projectRef}.supabase.co`);
      assert.equal(new URL(runtime.NEXT_PUBLIC_SUPABASE_URL).hostname, `${projectRef}.supabase.co`);
      if (runtime.NEXT_PUBLIC_SUPABASE_ANON_KEY !== runtime.SUPABASE_ANON_KEY)
        throw new Error('As chaves anônimas do runtime TEST não correspondem.');
      const belongsToTestProject = (databaseUrl) => {
        const parsed = new URL(databaseUrl ?? '');
        return (
          parsed.hostname === `db.${projectRef}.supabase.co` ||
          (parsed.hostname.endsWith('.pooler.supabase.com') &&
            decodeURIComponent(parsed.username).includes(projectRef))
        );
      };
      assert.ok(belongsToTestProject(runtime.DATABASE_URL));
      assert.ok(belongsToTestProject(runtime.DIRECT_URL));
    } else {
      assert.ok(
        verifiedProductionConnectedProjectRefs.has(projectRef),
        'Configuração do agendador bloqueada para refs não verificadas; QA exige SUPABASE_ENVIRONMENT=test.',
      );
    }
    assert.ok(
      runtime.CRON_SECRET?.length >= 32,
      `O runtime precisa de CRON_SECRET com 32+ caracteres (atual: ${runtime.CRON_SECRET?.length ?? 0}).`,
    );
    const baseUrl = apiUrl.toString().replace(/\/$/, '');
    if (activate) {
      stage = 'probe';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', runtime.CRON_SECRET)
        .update(`${timestamp}:notifications-dispatch`)
        .digest('hex');
      const response = await fetch(`${baseUrl}/notifications/dispatch/cron`, {
        headers: { 'X-Livio-Scheduled-At': timestamp, 'X-Livio-Signature': signature },
        signal: AbortSignal.timeout(55_000),
      });
      assert.equal(response.status, 200, 'Publique e valide a API antes de ativar o agendamento.');
    }
    await prisma.$transaction(
      async (transaction) => {
        stage = 'vault';
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('livio-notification-scheduler'))::text`;
        for (const [name, secret] of [
          ['livio_notifications_api_url', baseUrl],
          ['livio_notifications_cron_secret', runtime.CRON_SECRET],
        ]) {
          stage = `vault-read-${name}`;
          const [existing] =
            await transaction.$queryRaw`SELECT id FROM vault.secrets WHERE name = ${name}`;
          stage = `vault-write-${name}`;
          if (existing)
            await transaction.$queryRaw`SELECT vault.update_secret(${existing.id}::uuid, ${secret})::text`;
          else await transaction.$queryRaw`SELECT vault.create_secret(${secret}, ${name})`;
        }
        if (activate) {
          stage = 'schedule';
          await transaction.$queryRaw`SELECT cron.schedule('livio-notifications', '* * * * *', ${command})`;
        }
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }
  stage = 'inspect';
  const jobs =
    await prisma.$queryRaw`SELECT jobid::integer, schedule, active FROM cron.job WHERE jobname = 'livio-notifications'`;
  const permissions = await prisma.$queryRaw`SELECT
    has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT') AS anon_secrets_access,
    has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT') AS authenticated_secrets_access`;
  assert.ok(
    permissions.every((item) => Object.values(item).every((value) => value === false)),
    'Revise permissões do agendador antes de continuar.',
  );
  console.log(
    JSON.stringify({
      mode: apply ? 'configured' : 'read-only',
      projectRef,
      jobs,
      secretsPrivate: true,
      staticCredentialsInQueue: false,
    }),
  );
} catch (error) {
  // Database clients may include bound secret parameters in their diagnostic messages.
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : `Falha ao configurar o agendador em ${stage} (${error?.constructor?.name ?? 'erro'}${error?.code ? `, ${error.code}` : ''}${error?.meta?.code ? `, SQLSTATE ${error.meta.code}` : ''}); nenhum segredo foi exibido.`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
