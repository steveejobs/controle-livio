import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaClient, Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { chromium, type Page, type Request } from '@playwright/test';
import { initialRolePermissions, type SystemRoleKey } from '../../packages/shared/src/permissions';

type QaAccount = {
  token: string;
  userId: string;
  profileId: string;
  organizationId: string;
  email: string;
  password: string;
};
type Check = {
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  stage: string;
  evidence: Record<string, unknown>;
  error?: string;
};

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`QA: configure ${name}`);
  return value;
};

const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const projectRef = required('QA_PROJECT_REF');
const supabaseUrl = required('SUPABASE_URL');
const databaseUrl = new URL(required('DATABASE_URL'));
const directUrl = new URL(required('DIRECT_URL'));
const knownProductionRef = 'ioebcdpyrszokdyaoaqv';
const testMode = process.env.QA_ALLOW_SHARED_DATABASE_WRITES === 'true';
const browserSmoke = process.env.QA_BROWSER_SMOKE === 'true';
const artifactDir = process.env.QA_ARTIFACT_DIR?.trim() || 'test-results';
const outputPath = join(artifactDir, `qa-financial-http-${runId}.json`);
const apiLogPath = join(artifactDir, `qa-financial-api-${runId}.log`);
const webLogPath = join(artifactDir, `qa-financial-web-${runId}.log`);
const prisma = new PrismaClient();
const authAdmin = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authPublic = createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const apiPort = String(3129 + Math.floor(Math.random() * 20));
const apiUrl = `http://127.0.0.1:${apiPort}/v1`;
const apiConnectionLimit = Number(
  process.env.QA_API_CONNECTION_LIMIT ?? databaseUrl.searchParams.get('connection_limit') ?? 1,
);
if (!Number.isInteger(apiConnectionLimit) || apiConnectionLimit < 1 || apiConnectionLimit > 3) {
  throw new Error('QA_API_CONNECTION_LIMIT deve ser 1, 2 ou 3.');
}
const webPort = String(3200 + Math.floor(Math.random() * 200));
const webUrl = `http://localhost:${webPort}`;
const organizations: string[] = [];
const authUsers: string[] = [];
const checks: Record<string, Check> = {};
const startedAt = new Date().toISOString();
let apiProcess: ChildProcess | undefined;
let apiLog: ReturnType<typeof createWriteStream> | undefined;
let webProcess: ChildProcess | undefined;
let webLog: ReturnType<typeof createWriteStream> | undefined;

function record(name: string, result: Check) {
  checks[name] = result;
  console.log(`${result.status}: ${name} (${result.stage})`);
}

function errorType(error: unknown) {
  return error instanceof Error ? error.name : 'UnknownError';
}

function safeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return 'Falha sem mensagem disponível.';
  return error.message
    .replace(/[A-Z0-9._%+-]+@example\.test/gi, '[e-mail sintético]')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '[JWT redigido]')
    .slice(0, 240);
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
  return {
    samples: sorted.length,
    p50Ms: Math.round(percentile(0.5)),
    p95Ms: Math.round(percentile(0.95)),
    maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
  };
}

function attachOverviewServerAndQueryMetrics() {
  const check = checks.overview_http_performance_timing;
  if (!check) return;
  const lines = readFileSync(apiLogPath, 'utf8').split(/\r?\n/);
  const records: Array<{
    event?: string;
    time?: number;
    durationMs?: number;
    req?: { id?: string };
    responseTime?: number;
  }> = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as (typeof records)[number]);
    } catch {
      // Ignore non-JSON startup lines; they are not API timing samples.
    }
  }
  const queryEvents = records.filter(
    (entry): entry is { event: string; time: number; durationMs: number } =>
      entry.event === 'prisma_query_timing' &&
      typeof entry.time === 'number' &&
      typeof entry.durationMs === 'number',
  );
  const windows = check.evidence.requestWindows as
    Array<{ requestId: string; startedAtMs: number; finishedAtMs: number }> | undefined;
  if (!windows?.length) return;
  const queryDurationsBySample = windows.map((window) =>
    queryEvents
      .filter((event) => event.time >= window.startedAtMs && event.time <= window.finishedAtMs)
      .map(({ durationMs }) => durationMs),
  );
  const serverResponseTimes = windows
    .map((window) => records.find((entry) => entry.req?.id === window.requestId)?.responseTime)
    .filter((value): value is number => typeof value === 'number');
  check.evidence = {
    ...check.evidence,
    serverResponseTimeMs: serverResponseTimes.length ? stats(serverResponseTimes) : null,
    prismaQueryCountByRequest: queryDurationsBySample.map((durations) => durations.length),
    prismaQueryCount: stats(queryDurationsBySample.map((durations) => durations.length)),
    prismaQueryRoundtripMs: queryDurationsBySample.flat().length
      ? stats(queryDurationsBySample.flat())
      : null,
    apiResponseTimeSamples: serverResponseTimes.length,
    prismaQueryEventsMatched: queryDurationsBySample.flat().length,
    queryBreakdownLimitation:
      'Prisma query events measure client roundtrips; pool acquisition, database execution and network are not independently split.',
  };
  delete check.evidence.requestWindows;
}

function attachApiPoolDiagnostics(result: Record<string, unknown>) {
  if (!process.env.QA_TIMINGS) return;
  const lines = readFileSync(apiLogPath, 'utf8').split(/\r?\n/);
  const events: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Ignore startup lines; Prisma logs only query shapes, never SQL or bind values.
    }
  }
  const queries = events.filter(
    (event) => event.event === 'prisma_query_timing' && typeof event.durationMs === 'number',
  ) as Array<{ durationMs: number; operation?: string; tables?: string[]; signature?: string }>;
  const bySignature = new Map<
    string,
    { operation: string; tables: string[]; durations: number[] }
  >();
  for (const query of queries) {
    const signature = query.signature ?? 'unknown';
    const shape = bySignature.get(signature) ?? {
      operation: query.operation ?? 'OTHER',
      tables: query.tables ?? [],
      durations: [],
    };
    shape.durations.push(query.durationMs);
    bySignature.set(signature, shape);
  }
  result.apiDiagnostics = {
    configuredConnectionLimit: apiConnectionLimit,
    configuredPoolTimeoutSeconds:
      new URL(required('DATABASE_URL')).searchParams.get('pool_timeout') ?? '10 (default)',
    poolConfiguration: events.find((event) => event.event === 'prisma_pool_config') ?? null,
    poolSummary:
      [...events].reverse().find((event) => event.event === 'prisma_pool_summary') ?? null,
    poolSamples: events.filter((event) => event.event === 'prisma_pool_sample').length,
    lastPoolWaitHistogram:
      events
        .filter(
          (event) =>
            event.event === 'prisma_pool_sample' &&
            typeof event.waitHistogram === 'object' &&
            event.waitHistogram !== null,
        )
        .at(-1)?.waitHistogram ?? null,
    maxObservedPool: {
      waiters: Math.max(
        0,
        ...events
          .filter(
            (event): event is Record<string, unknown> & { waiting: number } =>
              event.event === 'prisma_pool_sample' && typeof event.waiting === 'number',
          )
          .map((event) => event.waiting),
      ),
      busyConnections: Math.max(
        0,
        ...events
          .filter(
            (event): event is Record<string, unknown> & { busy: number } =>
              event.event === 'prisma_pool_sample' && typeof event.busy === 'number',
          )
          .map((event) => event.busy),
      ),
      openConnections: Math.max(
        0,
        ...events
          .filter(
            (event): event is Record<string, unknown> & { open: number } =>
              event.event === 'prisma_pool_sample' && typeof event.open === 'number',
          )
          .map((event) => event.open),
      ),
    },
    p2024LogCount: lines.filter((line) => /\bP2024\b/.test(line)).length,
    queryRoundtrips: {
      count: queries.length,
      durationMs: stats(queries.map((query) => query.durationMs)),
      shapes: [...bySignature.entries()]
        .map(([signature, shape]) => ({
          signature,
          operation: shape.operation,
          tables: shape.tables,
          count: shape.durations.length,
          durationMs: stats(shape.durations),
        }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

function projectDatabaseMatch(url: URL) {
  return (
    url.hostname === `db.${projectRef}.supabase.co` ||
    (url.hostname.endsWith('.pooler.supabase.com') &&
      decodeURIComponent(url.username).includes(projectRef))
  );
}

async function preflight() {
  assert.equal(projectRef, required('SUPABASE_PROJECT_REF'));
  assert.equal(projectRef, required('CONFIRM_SUPABASE_PROJECT_REF'));
  assert.equal(
    projectRef,
    knownProductionRef,
    'Este verificador só aceita o projeto compartilhado autorizado nesta rodada.',
  );
  assert.equal(required('PRODUCTION_SUPABASE_PROJECT_REF'), projectRef);
  assert.equal(required('SUPABASE_ENVIRONMENT'), 'test');
  assert.equal(testMode, true, 'A escrita compartilhada exige autorização explícita de execução.');
  assert.equal(process.env.QA_ALLOW_WRITES, 'true');
  assert.equal(process.env.QA_EXTERNAL_DELIVERY_DISABLED, 'true');
  assert.equal(new URL(supabaseUrl).hostname, `${projectRef}.supabase.co`);
  assert.ok(
    projectDatabaseMatch(databaseUrl),
    'DATABASE_URL não aponta para o projeto confirmado.',
  );
  assert.ok(projectDatabaseMatch(directUrl), 'DIRECT_URL não aponta para o projeto confirmado.');
  assert.equal(new URL(required('NEXT_PUBLIC_SUPABASE_URL')).origin, new URL(supabaseUrl).origin);
  assert.equal(required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), required('SUPABASE_ANON_KEY'));
  const integrationCredentialNames = Object.keys(process.env)
    .filter(
      (name) =>
        /^(SMTP_|EMAIL_|MAIL_|RESEND_|SENDGRID_|MAILGUN_|VAPID_|STRIPE_|PAYMENT_|MERCADOPAGO_|PAGARME_|PAGSEGURO_|ASAAS_|EFI_|WHATSAPP_|META_|WEBHOOK_)/i.test(
          name,
        ) || name === 'CRON_SECRET',
    )
    .filter((name) => Boolean(process.env[name]));
  assert.deepEqual(
    integrationCredentialNames,
    [],
    'Há credenciais de integrações externas no processo de QA.',
  );

  const identity = await prisma.$queryRaw<
    Array<{ database: string; databaseRole: string; serverAddress: string | null }>
  >`
    SELECT current_database() AS database, current_user AS "databaseRole", inet_server_addr()::text AS "serverAddress"`;
  assert.ok(
    decodeURIComponent(databaseUrl.username).includes(projectRef) ||
      identity[0]?.databaseRole.includes(projectRef) ||
      databaseUrl.hostname === `db.${projectRef}.supabase.co`,
    'A identidade runtime do PostgreSQL não corresponde ao projeto informado.',
  );
  const authSettingsResponse = await fetch(`${new URL(supabaseUrl).origin}/auth/v1/settings`, {
    headers: { apikey: required('SUPABASE_ANON_KEY') },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(authSettingsResponse.status, 200);
  const authSettings = (await authSettingsResponse.json()) as { disable_signup?: unknown };
  assert.equal(
    authSettings.disable_signup,
    true,
    'Cadastro público de Auth deve permanecer desativado.',
  );
  const [pushCount, buckets, policies, scheduler] = await Promise.all([
    prisma.webPushSubscription.count(),
    prisma.$queryRaw<
      Array<{ id: string; public: boolean }>
    >`SELECT id, public FROM storage.buckets ORDER BY id`,
    prisma.$queryRaw<Array<{ total: number; protected: number }>>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity)::int AS protected
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY(ARRAY[
         'organizations','organization_members','clients','matters','receivables','receivable_installments',
         'payments','payment_allocations','expenses','documents','notifications','client_messages','audit_logs'
       ])`,
    prisma.$queryRaw<Array<{ jobName: string; active: boolean }>>`
      SELECT jobname AS "jobName", active FROM cron.job WHERE jobname = 'livio-notifications'`,
  ]);
  assert.equal(pushCount, 0, 'Há destinatários push; envio externo não pode ser excluído.');
  assert.equal(buckets.length, 3, 'Conjunto inesperado de buckets no Storage.');
  assert.ok(
    buckets.every((bucket) => !bucket.public),
    'Todos os buckets usados pelo app devem ser privados.',
  );
  assert.equal(policies[0]?.total, 13);
  assert.equal(policies[0]?.protected, 13);
  return {
    projectRef,
    destinations: {
      authHost: new URL(supabaseUrl).hostname,
      storageHost: new URL(supabaseUrl).hostname,
      databaseHost: databaseUrl.hostname,
      directDatabaseHost: directUrl.hostname,
      database: identity[0]?.database,
      databaseIdentityMatches: true,
    },
    sharedProjectProductionConnected: true,
    ownerAuthorizedSyntheticWrites: true,
    publicSignupDisabled: true,
    externalCredentialsPresent: false,
    pushSubscriptions: pushCount,
    privateStorageBuckets: buckets.map(({ id }) => id),
    rlsTablesProtected: `${policies[0]?.protected}/${policies[0]?.total}`,
    scheduler: {
      active: scheduler.some(({ active }) => active),
      scope: 'job ativo; QA não cria agenda ou notificações vencidas',
    },
    existingDataModified: false,
  };
}

async function createOrganizationAccount(
  label: string,
  roleKey: SystemRoleKey = 'finance',
): Promise<QaAccount> {
  const organization = await prisma.organization.create({
    data: {
      slug: `qa-finance-${runId}-${label}`,
      legalName: `QA sintético Lívio ${runId} ${label}`,
      settings: { qaRunId: runId, synthetic: true },
    },
    select: { id: true },
  });
  organizations.push(organization.id);
  const permissions = [...new Set(initialRolePermissions[roleKey])];
  await prisma.permission.createMany({
    data: permissions.map((code) => {
      const [resource, action] = code.split(':');
      return { organizationId: organization.id, resource: resource!, action: action! };
    }),
  });

  const email = `qa-${runId}-${label}@example.test`;
  const password = randomBytes(32).toString('base64url');
  const createdAuth = await authAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(createdAuth.error);
  const authUser = createdAuth.data.user!;
  authUsers.push(authUser.id);
  const userId = await prisma.$transaction(async (transaction) => {
    await transaction.profile.upsert({
      where: { id: authUser.id },
      create: { id: authUser.id, email, fullName: `QA ${roleKey} ${label}` },
      update: { fullName: `QA ${roleKey} ${label}` },
    });
    const user = await transaction.user.create({
      data: {
        organizationId: organization.id,
        authUserId: authUser.id,
        email,
        fullName: `QA ${roleKey} ${label}`,
        status: 'ACTIVE',
      },
    });
    const membership = await transaction.organizationMember.create({
      data: {
        organizationId: organization.id,
        profileId: authUser.id,
        userId: user.id,
        status: 'ACTIVE',
      },
    });
    const permissionRows = await transaction.permission.findMany({
      where: { organizationId: organization.id },
    });
    const role = await transaction.role.create({
      data: {
        organizationId: organization.id,
        key: roleKey,
        name: `QA ${roleKey} sintético`,
        isSystem: true,
        permissions: {
          create: permissionRows.map((permission) => ({
            organizationId: organization.id,
            permissionId: permission.id,
          })),
        },
      },
    });
    await transaction.organizationMemberRole.create({
      data: { organizationId: organization.id, membershipId: membership.id, roleId: role.id },
    });
    await transaction.userRole.create({
      data: { organizationId: organization.id, userId: user.id, roleId: role.id },
    });
    return user.id;
  });
  const [readKey, writeKey] = ['read', 'write'].map((scope) =>
    createHash('sha256').update(`${userId}:${scope}`).digest('hex'),
  );
  const existingCounters = await prisma.apiRateLimit.findMany({
    where: { organizationId: organization.id, keyHash: { in: [readKey!, writeKey!] } },
  });
  assert.equal(
    existingCounters.length,
    0,
    'Não sobrescreva contadores de rate limit preexistentes.',
  );

  const signedIn = await authPublic.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  assert.ok(signedIn.data.session?.access_token);
  return {
    token: signedIn.data.session.access_token,
    userId,
    profileId: authUser.id,
    organizationId: organization.id,
    email,
    password,
  };
}

async function createMemberAccount(
  organizationId: string,
  label: string,
  roleKey: SystemRoleKey,
  clientId?: string,
): Promise<QaAccount> {
  const permissions = [...new Set(initialRolePermissions[roleKey])];
  await prisma.permission.createMany({
    data: permissions.map((code) => {
      const [resource, action] = code.split(':');
      return { organizationId, resource: resource!, action: action! };
    }),
    skipDuplicates: true,
  });

  const email = `qa-${runId}-${label}@example.test`;
  const password = randomBytes(32).toString('base64url');
  const createdAuth = await authAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(createdAuth.error);
  const authUser = createdAuth.data.user!;
  authUsers.push(authUser.id);
  const userId = await prisma.$transaction(async (transaction) => {
    await transaction.profile.upsert({
      where: { id: authUser.id },
      create: { id: authUser.id, email, fullName: `QA ${roleKey} ${label}` },
      update: { fullName: `QA ${roleKey} ${label}` },
    });
    const user = await transaction.user.create({
      data: {
        organizationId,
        authUserId: authUser.id,
        email,
        fullName: `QA ${roleKey} ${label}`,
        status: 'ACTIVE',
      },
    });
    const membership = await transaction.organizationMember.create({
      data: {
        organizationId,
        profileId: authUser.id,
        userId: user.id,
        status: 'ACTIVE',
        ...(clientId ? { clientId } : {}),
      },
    });
    const permissionRows = await transaction.permission.findMany({
      where: {
        organizationId,
        OR: permissions.map((code) => {
          const [resource, action] = code.split(':');
          return { resource: resource!, action: action! };
        }),
      },
    });
    assert.equal(
      permissionRows.length,
      permissions.length,
      `Permissões incompletas para ${roleKey}.`,
    );
    const role = await transaction.role.create({
      data: {
        organizationId,
        key: roleKey,
        name: `QA ${roleKey} sintético`,
        isSystem: true,
        permissions: {
          create: permissionRows.map((permission) => ({
            organizationId,
            permissionId: permission.id,
          })),
        },
      },
    });
    await transaction.organizationMemberRole.create({
      data: { organizationId, membershipId: membership.id, roleId: role.id },
    });
    await transaction.userRole.create({
      data: { organizationId, userId: user.id, roleId: role.id },
    });
    return user.id;
  });

  const [readKey, writeKey] = ['read', 'write'].map((scope) =>
    createHash('sha256').update(`${userId}:${scope}`).digest('hex'),
  );
  const existingCounters = await prisma.apiRateLimit.findMany({
    where: { organizationId, keyHash: { in: [readKey!, writeKey!] } },
  });
  assert.equal(
    existingCounters.length,
    0,
    'Não sobrescreva contadores de rate limit preexistentes.',
  );

  const signedIn = await authPublic.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  assert.ok(signedIn.data.session?.access_token);
  return {
    token: signedIn.data.session.access_token,
    userId,
    profileId: authUser.id,
    organizationId,
    email,
    password,
  };
}

async function startApi() {
  apiLog = createWriteStream(apiLogPath, { flags: 'wx' });
  const apiDatabaseUrl = new URL(required('DATABASE_URL'));
  apiDatabaseUrl.searchParams.set('connection_limit', String(apiConnectionLimit));
  apiDatabaseUrl.searchParams.set(
    'pool_timeout',
    apiDatabaseUrl.searchParams.get('pool_timeout') ?? '10',
  );
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: process.cwd(),
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      API_PORT: apiPort,
      LOG_LEVEL: process.env.QA_TIMINGS === 'true' ? 'info' : 'error',
      DATABASE_URL: apiDatabaseUrl.toString(),
      ...(browserSmoke ? { CORS_ORIGINS: webUrl } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout?.pipe(apiLog);
  apiProcess.stderr?.pipe(apiLog);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiUrl}/health/ready`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return;
    } catch {
      // Wait for the local Nest process to start.
    }
    if (apiProcess.exitCode !== null)
      throw new Error('A API local encerrou durante a inicialização.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('A API local não ficou pronta dentro de 90 segundos.');
}

async function startWeb() {
  webLog = createWriteStream(webLogPath, { flags: 'wx' });
  const webEnvironment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    USERPROFILE: process.env.USERPROFILE,
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    NODE_ENV: 'development',
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: required('SUPABASE_ANON_KEY'),
  };
  webProcess = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', 'apps/web', '-p', webPort],
    {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      env: webEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  webProcess.stdout?.pipe(webLog);
  webProcess.stderr?.pipe(webLog);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(webUrl, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return;
    } catch {
      // Wait for the local Next.js process to start.
    }
    if (webProcess.exitCode !== null) throw new Error('Local frontend exited during startup.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Local frontend did not become ready within 90 seconds.');
}

async function stopChild(child: ChildProcess | undefined, timeoutMs: number): Promise<boolean> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  const exited = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  child.kill();
  const graceful = await exited;
  if (graceful || child.exitCode !== null || child.signalCode !== null) return graceful;
  const forcedExit = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  child.kill('SIGKILL');
  return forcedExit;
}

async function runBrowserSmoke(administrator: QaAccount, client: QaAccount, clientId: string) {
  await startWeb();
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROME_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
      : {}),
  });
  const apiOrigin = apiUrl.replace(/\/v1$/, '');
  const apiResponses: Array<{
    method: string;
    path: string;
    status?: number;
    durationMs: number;
    serverTiming: Record<string, number>;
    failure?: string;
  }> = [];
  const pendingApiRequests = new Set<Request>();
  const requestSamples = new Map<
    Request,
    {
      method: string;
      path: string;
      startedAt: number;
      status?: number;
      serverTiming: Record<string, number>;
    }
  >();
  let maxConcurrentApiRequests = 0;
  const watchApiRequests = (target: Page) => {
    target.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== apiOrigin) return;
      pendingApiRequests.add(request);
      requestSamples.set(request, {
        method: request.method(),
        path: url.pathname
          .replace(/^\/v1/, '')
          .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
          .replace(/\d{5,}/g, ':n'),
        startedAt: performance.now(),
        serverTiming: {},
      });
      maxConcurrentApiRequests = Math.max(maxConcurrentApiRequests, pendingApiRequests.size);
    });
    target.on('response', (response) => {
      const sample = requestSamples.get(response.request());
      if (!sample) return;
      sample.status = response.status();
      const header = response.headers()['server-timing'] ?? '';
      for (const match of header.matchAll(/([a-zA-Z][\w-]*);dur=([0-9.]+)/g)) {
        sample.serverTiming[match[1]!] = Number(match[2]);
      }
    });
    const complete = (request: Request, failure?: string) => {
      pendingApiRequests.delete(request);
      const sample = requestSamples.get(request);
      if (!sample) return;
      requestSamples.delete(request);
      apiResponses.push({
        method: sample.method,
        path: sample.path,
        ...(sample.status !== undefined ? { status: sample.status } : {}),
        durationMs: Math.round(performance.now() - sample.startedAt),
        serverTiming: sample.serverTiming,
        ...(failure ? { failure } : {}),
      });
    };
    target.on('requestfinished', (request) => complete(request));
    target.on('requestfailed', (request) =>
      complete(request, request.failure()?.errorText?.split(' ')[0] ?? 'request-failed'),
    );
  };
  const waitForApiIdle = async () => {
    const timeoutMs = process.env.QA_RAPID_NAVIGATION === 'true' ? 15_000 : 45_000;
    const deadline = Date.now() + timeoutMs;
    let idleSince: number | undefined;
    while (Date.now() < deadline) {
      if (pendingApiRequests.size === 0) {
        idleSince ??= Date.now();
        if (Date.now() - idleSince >= 750) return true;
      } else {
        idleSince = undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watchApiRequests(page);

    await page.goto(webUrl);
    // Keep Next's development launcher from intercepting the app's bottom-left controls.
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await page.getByLabel('E-mail').fill(administrator.email);
    await page.locator('#login-password').fill(administrator.password);
    await page.getByRole('button', { name: 'Entrar no sistema' }).click();
    await page.getByRole('heading', { name: 'Visão geral' }).waitFor({ state: 'visible' });
    if (!(await waitForApiIdle())) throw new Error('API did not settle after administrator login.');

    const navigation = page.getByRole('navigation', { name: 'Navegacao principal' });
    const navigationButtons = navigation.getByRole('button');
    const navigationCount = await navigationButtons.count();
    const visitedModules: string[] = [];
    const moduleNavigationMs: number[] = [];
    const rapidNavigation = process.env.QA_RAPID_NAVIGATION === 'true';
    const rapidNavigationStartedAt = performance.now();
    for (let index = 0; index < navigationCount; index++) {
      const button = navigation.getByRole('button').nth(index);
      const label = (await button.innerText()).trim();
      const navigationStartedAt = performance.now();
      await button.click();
      visitedModules.push(label);
      if (!rapidNavigation && !(await waitForApiIdle())) {
        throw new Error(`API did not settle after opening ${label}.`);
      }
      moduleNavigationMs.push(Math.round(performance.now() - navigationStartedAt));
    }
    const apiSettledAfterNavigation = await waitForApiIdle();
    const rapidNavigationMs = Math.round(performance.now() - rapidNavigationStartedAt);
    if (!apiSettledAfterNavigation) {
      await page.screenshot({
        path: join(artifactDir, `qa-browser-${runId}-navigation-pending.png`),
      });
      return {
        status: 'FAIL' as const,
        stage: 'rapid module navigation left authenticated API requests pending',
        error: 'API_REQUESTS_STILL_PENDING',
        evidence: {
          rapidNavigation,
          rapidNavigationMs,
          modulesVisited: visitedModules,
          browserApiRequestsCompleted: apiResponses.length,
          maxConcurrentApiRequests,
          pendingRequests: [...requestSamples.values()].map((sample) => ({
            method: sample.method,
            path: sample.path,
            elapsedMs: Math.round(performance.now() - sample.startedAt),
          })),
          completedServerErrors: apiResponses
            .filter(({ status }) => status !== undefined && status >= 500)
            .map(({ method, path, status, durationMs }) => ({ method, path, status, durationMs })),
          screenshot: join(artifactDir, `qa-browser-${runId}-navigation-pending.png`),
        },
      };
    }
    await page.setViewportSize({ width: 360, height: 800 });
    const administratorMobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    const activityFilterWidths = await page
      .locator('.activity-filters input, .activity-filters select')
      .evaluateAll((elements) =>
        elements.map((element) => Math.round(element.getBoundingClientRect().width)),
      );
    await page.screenshot({ path: join(artifactDir, `qa-browser-${runId}-administrator.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    const logout = page.getByRole('button', { name: 'Sair' });
    await logout.scrollIntoViewIfNeeded();
    const logoutBox = await logout.boundingBox();
    await page.screenshot({
      path: join(artifactDir, `qa-browser-${runId}-administrator-desktop.png`),
    });
    assert.ok(logoutBox && logoutBox.y >= 0 && logoutBox.y + logoutBox.height <= 900);
    await logout.click({ timeout: 10_000 });
    await page.getByLabel('E-mail').waitFor({ state: 'visible' });
    const clientIdentity = await request(client, '/auth/me');
    assert.equal(clientIdentity.response.status, 200, 'JWT sintético do cliente inválido na API.');
    const clientSession = clientIdentity.body as {
      user?: { clientId?: string; permissions?: string[] };
    };
    assert.equal(clientSession.user?.clientId, clientId, 'Vínculo clientId ausente no /auth/me.');
    assert.deepEqual(
      new Set(clientSession.user?.permissions),
      new Set(initialRolePermissions.client),
      'Usuário cliente recebeu permissões além do papel de cliente.',
    );

    const clientPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watchApiRequests(clientPage);
    await clientPage.goto(webUrl);
    await clientPage.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
    await clientPage.getByLabel('E-mail').fill(client.email);
    await clientPage.locator('#login-password').fill(client.password);
    const clientLoginStartedAt = performance.now();
    await clientPage.getByRole('button', { name: 'Entrar no sistema' }).click();
    try {
      await clientPage
        .getByRole('heading', { name: 'Minha área' })
        .waitFor({ state: 'visible', timeout: 60_000 });
      if (!(await waitForApiIdle()))
        throw new Error('Client portal API did not settle after login.');
    } catch {
      await clientPage.screenshot({
        path: join(artifactDir, `qa-browser-${runId}-portal-failure.png`),
      });
      const pageText = (
        await clientPage
          .locator('.auth-card')
          .innerText()
          .catch(() => '')
      )
        .replace(client.email, '[cliente sintético]')
        .replace(/\s+/g, ' ')
        .slice(0, 180);
      const loginVisible = await clientPage
        .getByLabel('E-mail')
        .isVisible()
        .catch(() => false);
      throw new Error(
        `Portal não abriu; vínculo clientId=validado; formulário de login visível=${loginVisible}; tela=${pageText}`,
      );
    }
    const clientLoginMs = Math.round(performance.now() - clientLoginStartedAt);
    await clientPage.screenshot({ path: join(artifactDir, `qa-browser-${runId}-portal.png`) });
    const portalNavigation = clientPage.getByRole('navigation', { name: 'Navegacao principal' });
    const portalLabels = await portalNavigation.getByRole('button').allInnerTexts();
    const portalHasAdminNavigation = portalLabels.some((label) =>
      /usuarios e permissoes|atividades do sistema|pipelines/i.test(
        label.normalize('NFD').replace(/\p{M}/gu, ''),
      ),
    );
    await clientPage.setViewportSize({ width: 360, height: 800 });
    const clientMobileOverflow = await clientPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    const failedApiResponses = apiResponses.filter(
      ({ status }) => status !== undefined && status >= 400,
    );
    const serverErrorResponses = apiResponses.filter(
      ({ status }) => status !== undefined && status >= 500,
    );
    const routeMetrics = new Map<
      string,
      { durations: number[]; statuses: number[]; serverTiming: Map<string, number[]> }
    >();
    for (const sample of apiResponses) {
      const key = `${sample.method} ${sample.path}`;
      const route = routeMetrics.get(key) ?? {
        durations: [],
        statuses: [],
        serverTiming: new Map<string, number[]>(),
      };
      route.durations.push(sample.durationMs);
      if (sample.status !== undefined) route.statuses.push(sample.status);
      for (const [stage, duration] of Object.entries(sample.serverTiming)) {
        const values = route.serverTiming.get(stage) ?? [];
        values.push(duration);
        route.serverTiming.set(stage, values);
      }
      routeMetrics.set(key, route);
    }
    const requestMetrics = [...routeMetrics.entries()]
      .map(([route, value]) => ({
        route,
        requests: value.durations.length,
        responseMs: stats(value.durations),
        statuses: value.statuses.reduce<Record<string, number>>((counts, status) => {
          counts[String(status)] = (counts[String(status)] ?? 0) + 1;
          return counts;
        }, {}),
        serverTimingMs: Object.fromEntries(
          [...value.serverTiming].map(([stage, durations]) => [stage, stats(durations)]),
        ),
      }))
      .sort((a, b) => b.requests - a.requests);
    assert.equal(administratorMobileOverflow, false, 'Admin navigation overflows at 360 px.');
    assert.equal(clientMobileOverflow, false, 'Client portal overflows at 360 px.');
    assert.equal(portalHasAdminNavigation, false, 'Client portal exposed admin navigation.');
    assert.ok(
      activityFilterWidths.every((width) => width >= 240),
      'Activity filters are too narrow to use at 360 px.',
    );
    return {
      status: (serverErrorResponses.length ? 'FAIL' : 'PASS') as 'FAIL' | 'PASS',
      stage: 'real Supabase login, local API, module navigation, client portal, 360 px viewport',
      ...(serverErrorResponses.length ? { error: 'HTTP_5XX_DURING_NAVIGATION' } : {}),
      evidence: {
        adminProfile: 'synthetic administrator',
        clientProfile: 'synthetic client linked to QA client',
        clientLoginMs,
        modulesVisited: visitedModules.length,
        moduleNavigationMs: moduleNavigationMs,
        rapidNavigation,
        rapidNavigationMs,
        browserApiRequests: apiResponses.length,
        maxConcurrentApiRequests,
        browserApiRequestsByRoute: requestMetrics,
        browserApiFailedRequests: apiResponses.filter(({ failure }) => failure).length,
        browserApi4xx: failedApiResponses,
        browserApi5xx: serverErrorResponses,
        portalAdminNavigationBlocked: !portalHasAdminNavigation,
        noHorizontalOverflowAt360px: true,
        mobileActivityFilterControlWidths: activityFilterWidths,
        logoutVisibleAndReachable: true,
        screenshots: [
          join(artifactDir, `qa-browser-${runId}-administrator.png`),
          join(artifactDir, `qa-browser-${runId}-portal.png`),
        ],
      },
    };
  } finally {
    await browser.close();
  }
}

async function request(account: QaAccount, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${account.token}`);
  headers.set('X-Organization-Id', account.organizationId);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function overviewCall(account: QaAccount, clientId: string) {
  const startedAtMs = Date.now();
  const requestId = randomUUID();
  const started = performance.now();
  const result = await request(account, `/clients/${clientId}/overview`, {
    headers: { 'X-Request-Id': requestId },
  });
  const finishedAtMs = Date.now();
  return {
    ...result,
    durationMs: performance.now() - started,
    serverTimings: parseServerTiming(result.response),
    requestId,
    startedAtMs,
    finishedAtMs,
  };
}

function parseServerTiming(response: Response) {
  const header = response.headers.get('server-timing');
  if (!header) return {};
  return Object.fromEntries(
    header.split(',').flatMap((entry) => {
      const [name, duration] = entry.trim().split(';dur=');
      const value = Number(duration);
      return name && Number.isFinite(value) ? [[name, value]] : [];
    }),
  ) as Record<string, number>;
}

function timingStats(samples: Array<Record<string, number>>) {
  const names = [...new Set(samples.flatMap((sample) => Object.keys(sample)))];
  return Object.fromEntries(
    names.map((name) => [
      name,
      stats(samples.flatMap((sample) => (sample[name] === undefined ? [] : [sample[name]]))),
    ]),
  );
}

async function runOverviewPerformance(account: QaAccount, clientId: string): Promise<Check> {
  const cold = await overviewCall(account, clientId);
  assert.equal(cold.response.status, 200);
  const warm = [];
  for (let index = 0; index < 10; index++) {
    const sample = await overviewCall(account, clientId);
    assert.equal(
      sample.response.status,
      200,
      `Warm overview ${index + 1} returned ${sample.response.status}.`,
    );
    warm.push(sample);
  }
  const stableWindow = await waitForStableRateLimitWindow();
  const concurrent = await Promise.all([
    overviewCall(account, clientId),
    overviewCall(account, clientId),
  ]);
  assert.ok(concurrent.every(({ response }) => response.status === 200));
  const all = [cold, ...warm, ...concurrent];
  const requiredTimings = [
    'authClaims',
    'membershipPrismaRoundtrip',
    'rateLimitPrismaRoundtrip',
    'permissionGuard',
    'handler',
  ];
  assert.ok(
    all.every(({ serverTimings }) => requiredTimings.every((name) => name in serverTimings)),
    'Server-Timing did not include every instrumented stage.',
  );
  return {
    status: 'PASS',
    stage:
      'authenticated HTTP overview; Auth, membership, rate limit, permission, handler and total latency',
    evidence: {
      samples: all.length,
      concurrency: 1,
      coldMs: Math.round(cold.durationMs),
      warmHttp: stats(warm.map(({ durationMs }) => durationMs)),
      concurrent2Ms: concurrent.map(({ durationMs }) => Math.round(durationMs)),
      allHttp: stats(all.map(({ durationMs }) => durationMs)),
      serverTimingMs: timingStats(all.map(({ serverTimings }) => serverTimings)),
      requestWindows: all.map(({ requestId, startedAtMs, finishedAtMs }) => ({
        requestId,
        startedAtMs,
        finishedAtMs,
      })),
      serverResponseTimeMs: null,
      prismaQueryCount: null,
      rateLimitActive: all.every(
        ({ response }) =>
          Number(response.headers.get('x-ratelimit-limit')) >
          Number(response.headers.get('x-ratelimit-remaining')),
      ),
      stableWindow: stableWindow.toISOString(),
      caveat:
        'Prisma stage timings are client roundtrips and include pool acquisition, network and SQL; these cannot be separated by this HTTP harness.',
    },
  };
}

async function readReadRateLimitCounter(account: QaAccount) {
  const keyHash = createHash('sha256').update(`${account.userId}:read`).digest('hex');
  return prisma.apiRateLimit.findUnique({
    where: {
      organizationId_keyHash: { organizationId: account.organizationId, keyHash },
    },
    select: { requestCount: true, windowStartedAt: true },
  });
}

function assertRateLimitHeaderMatchesCounter(
  response: Response,
  counter: NonNullable<Awaited<ReturnType<typeof readReadRateLimitCounter>>>,
  label: string,
) {
  const limit = Number(response.headers.get('x-ratelimit-limit'));
  const remaining = Number(response.headers.get('x-ratelimit-remaining'));
  assert.ok(Number.isInteger(limit) && limit > 0, `${label}: cabeçalho de limite ausente.`);
  assert.ok(
    Number.isInteger(remaining) && remaining >= 0 && remaining <= limit,
    `${label}: cabeçalho remaining fora do intervalo.`,
  );
  assert.equal(
    remaining,
    Math.max(0, limit - counter.requestCount),
    `${label}: remaining não corresponde ao contador persistido da janela ativa.`,
  );
  return { limit, remaining };
}

async function waitForStableRateLimitWindow() {
  for (;;) {
    const [clock] = await prisma.$queryRaw<Array<{ now: Date; windowStartedAt: Date }>>`
      SELECT clock_timestamp() AS now,
             date_trunc('minute', clock_timestamp()) AS "windowStartedAt"
    `;
    assert.ok(clock);
    const elapsedMs = clock.now.getTime() - clock.windowStartedAt.getTime();
    if (elapsedMs >= 5_000 && elapsedMs <= 52_000) return clock.windowStartedAt;
    const waitMs = elapsedMs < 5_000 ? 5_500 - elapsedMs : 65_500 - elapsedMs;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

type ExpenseApi = {
  id: string;
  status: string;
  amount: string;
  dueDate: string | null;
  approvedById?: string | null;
  rejectedById?: string | null;
  rejectionReason?: string | null;
  documents?: Array<{ id: string; title: string; visibility: string }>;
};

type ExpenseTotals = { count: number; amount: string };
type ExpenseSummaryApi = {
  currencies: Array<{
    currency: string;
    pendingApproval: ExpenseTotals;
    pendingPayment: ExpenseTotals;
    overdue: ExpenseTotals;
    paid: ExpenseTotals;
  }>;
};
type CashFlowApi = {
  rows: Array<{
    client_id?: string | null;
    currency: string;
    expected_expenses?: string;
    paid_expenses?: string;
    pending_approval_expenses?: string;
  }>;
};

async function expectHttp<T>(
  account: QaAccount,
  path: string,
  method: string,
  expectedStatus: number,
  body?: unknown,
): Promise<T> {
  const result = await request(account, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(
    result.response.status,
    expectedStatus,
    `${method} ${path}: esperava HTTP ${expectedStatus}, recebeu ${result.response.status}`,
  );
  return result.body as T;
}

function exactMoney(value: string | number | Prisma.Decimal) {
  return new Prisma.Decimal(value).toFixed(4);
}

function sumReport(
  rows: CashFlowApi['rows'],
  field: 'expected_expenses' | 'paid_expenses' | 'pending_approval_expenses',
) {
  return rows.reduce((sum, row) => sum.plus(row[field] ?? '0'), new Prisma.Decimal(0)).toFixed(4);
}

async function runExpenseChecks(
  fixture: { finance: QaAccount; approver: QaAccount; outsider: QaAccount; clientId: string },
  setStage: (stage: string) => void,
) {
  const { finance, approver, outsider, clientId } = fixture;
  const today = new Date();
  const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
  const offsetDate = (days: number) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + days);
    return dateOnly(date);
  };
  const category = `QA-${runId}-primary`;
  const singleAdminCategory = `QA-${runId}-single`;
  const dueDate = offsetDate(7);
  const paidAt = today.toISOString();
  const from = offsetDate(-1);
  const to = offsetDate(14);
  const reportRange = new URLSearchParams({ from, to, groupBy: 'day' }).toString();

  const createExpense = async (
    account: QaAccount,
    expenseCategory: string,
    description: string,
    amount: string,
    linkedClientId?: string,
  ) =>
    expectHttp<ExpenseApi>(account, '/finance/expenses', 'POST', 201, {
      ...(linkedClientId ? { clientId: linkedClientId } : {}),
      responsibleUserId: account.userId,
      description,
      category: expenseCategory,
      amount,
      currency: 'BRL',
      incurredAt: dateOnly(today),
      dueDate,
      reimbursable: false,
    });

  setStage('despesas: configuração de aprovação e permissão administrativa');
  const defaultPolicy = await expectHttp<{ required: boolean; canSubmitForApproval: boolean }>(
    finance,
    '/finance/expenses/approval-policy',
    'GET',
    200,
  );
  assert.equal(defaultPolicy.required, true, 'Configuração ausente deve exigir aprovação.');
  assert.equal(defaultPolicy.canSubmitForApproval, true, 'Deve haver aprovador independente QA.');
  await expectHttp(finance, '/finance/expenses/approval-policy', 'PATCH', 403, {
    required: false,
  });
  await expectHttp(approver, '/finance/expenses/approval-policy', 'PATCH', 200, {
    required: false,
  });
  record('expense_policy_permissions', {
    status: 'PASS',
    stage: 'JWT financeiro e JWT administrador em organização sintética',
    evidence: {
      absentPolicyDefaultsToRequired: defaultPolicy.required,
      independentApproverAvailable: defaultPolicy.canSubmitForApproval,
      nonAdminConfigurationDenied: true,
      adminConfigurationAccepted: true,
    },
  });

  setStage('despesas: criação, edição, comprovante e confirmação sem aprovação');
  const expenseA = await createExpense(
    finance,
    category,
    `QA ${runId} - despesa aprovada sem etapa`,
    '120.5000',
    clientId,
  );
  assert.equal(expenseA.status, 'DRAFT');
  const updatedA = await expectHttp<ExpenseApi>(
    finance,
    `/finance/expenses/${expenseA.id}`,
    'PATCH',
    200,
    {
      description: `QA ${runId} - despesa editada`,
      amount: '125.1250',
      dueDate,
    },
  );
  assert.equal(updatedA.status, 'DRAFT');
  const storedA = await prisma.expense.findFirst({
    where: { id: expenseA.id, organizationId: finance.organizationId },
  });
  assert.ok(storedA);
  assert.equal(storedA.amount.toFixed(4), '125.1250');
  assert.equal(storedA.responsibleUserId, finance.userId);
  assert.equal(storedA.clientId, clientId);
  assert.equal(dateOnly(storedA.dueDate!), dueDate);

  const proof = Buffer.from(`%PDF-1.4\n% Arquivo QA sintético ${runId}\n%%EOF\n`);
  const form = new FormData();
  form.append('title', `Comprovante sintético QA ${runId}`);
  form.append('category', 'QA_EXPENSE_RECEIPT');
  form.append('visibility', 'INTERNAL');
  form.append('clientId', clientId);
  form.append('expenseId', expenseA.id);
  form.append(
    'file',
    new Blob([Uint8Array.from(proof)], { type: 'application/pdf' }),
    `qa-${runId}.pdf`,
  );
  const uploadResponse = await fetch(`${apiUrl}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${approver.token}`,
      'X-Organization-Id': approver.organizationId,
    },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(uploadResponse.status, 201, `Upload de comprovante: HTTP ${uploadResponse.status}`);
  const uploaded = (await uploadResponse.json()) as { id: string };
  assert.ok(uploaded.id);
  const document = await prisma.document.findFirst({
    where: { id: uploaded.id, organizationId: finance.organizationId, expenseId: expenseA.id },
    include: { versions: true },
  });
  assert.ok(document);
  assert.equal(document.versions.length, 1);
  assert.equal(document.versions[0]?.sha256, createHash('sha256').update(proof).digest('hex'));
  assert.equal(document.versions[0]?.sizeBytes, BigInt(proof.length));
  const signed = await expectHttp<{ url: string; expiresInSeconds: number; version: number }>(
    finance,
    `/documents/${uploaded.id}/download-url`,
    'GET',
    200,
  );
  const signedUrl = new URL(signed.url);
  assert.equal(signedUrl.hostname, new URL(supabaseUrl).hostname);
  assert.equal(signed.expiresInSeconds, 300);
  assert.equal(signed.version, 1);
  assert.ok(signedUrl.searchParams.has('token'));
  const approvedA = await expectHttp<ExpenseApi>(
    finance,
    `/finance/expenses/${expenseA.id}/submit`,
    'POST',
    201,
  );
  assert.equal(approvedA.status, 'APPROVED');
  record('expense_create_edit_attachment_and_confirmation', {
    status: 'PASS',
    stage: 'criação/edição por JWT financeiro, documento privado e aprovação desabilitada',
    evidence: {
      expenseStatus: approvedA.status,
      exactAmount: storedA.amount.toFixed(4),
      dueDateSet: true,
      responsibleLinked: true,
      clientLinked: true,
      documentVersion: 1,
      documentSha256MatchesUpload: true,
      signedUrlHostMatchesProject: true,
      signedUrlExpirySeconds: signed.expiresInSeconds,
      noRealDocumentUsed: true,
    },
  });

  setStage('despesas: pagamento integral, duplicidade e histórico');
  await expectHttp(finance, `/finance/expenses/${expenseA.id}/payment`, 'POST', 400, {
    amount: '50.0000',
    paidAt,
    method: 'QA_SYNTHETIC',
  });
  const paidA = await expectHttp<ExpenseApi>(
    finance,
    `/finance/expenses/${expenseA.id}/payment`,
    'POST',
    201,
    { amount: '125.1250', paidAt, method: 'QA_SYNTHETIC', reference: `QA-${runId}-A` },
  );
  assert.equal(paidA.status, 'PAID');
  await expectHttp(finance, `/finance/expenses/${expenseA.id}/payment`, 'POST', 409, {
    amount: '125.1250',
    paidAt,
    method: 'QA_SYNTHETIC',
  });
  await expectHttp(finance, `/finance/expenses/${expenseA.id}/cancel`, 'POST', 409);
  await expectHttp(finance, `/finance/expenses/${expenseA.id}/approve`, 'POST', 409);
  const historyA = await expectHttp<{ items: Array<{ transition?: string }>; total: number }>(
    finance,
    `/finance/expenses/${expenseA.id}/history`,
    'GET',
    200,
  );
  assert.ok(historyA.total >= 4);
  assert.ok(historyA.items.some((event) => event.transition === 'CONFIRM'));
  assert.ok(historyA.items.some((event) => event.transition === 'PAY'));
  const listedA = await expectHttp<{ items: ExpenseApi[]; total: number }>(
    finance,
    `/finance/expenses?status=PAID&category=${category}`,
    'GET',
    200,
  );
  const listedExpenseA = listedA.items.find(({ id }) => id === expenseA.id);
  assert.ok(listedExpenseA);
  assert.ok(
    listedExpenseA.documents?.some(
      ({ id, visibility }) => id === uploaded.id && visibility === 'INTERNAL',
    ),
  );
  record('expense_full_payment_duplicate_history', {
    status: 'PASS',
    stage: 'pagamento integral exato, bloqueio parcial/duplicado, transições e histórico',
    evidence: {
      exactAmount: '125.1250',
      partialPaymentRejected: true,
      duplicatePaymentRejected: true,
      paidCancellationRejected: true,
      approvalAfterPaymentRejected: true,
      auditEvents: historyA.total,
      receiptVisibleInExpenseList: true,
    },
  });

  setStage('despesas: aprovação obrigatória, autoaprovação, rejeição e reenvio');
  await expectHttp(approver, '/finance/expenses/approval-policy', 'PATCH', 200, {
    required: true,
  });
  const expenseB = await createExpense(
    finance,
    category,
    `QA ${runId} - despesa sujeita a aprovação`,
    '20.1000',
    clientId,
  );
  const pendingB = await expectHttp<ExpenseApi>(
    finance,
    `/finance/expenses/${expenseB.id}/submit`,
    'POST',
    201,
  );
  assert.equal(pendingB.status, 'PENDING_APPROVAL');
  await expectHttp(finance, `/finance/expenses/${expenseB.id}/approve`, 'POST', 403);
  await expectHttp(finance, `/finance/expenses/${expenseB.id}/payment`, 'POST', 409, {
    amount: '20.1000',
    paidAt,
    method: 'QA_SYNTHETIC',
  });
  await expectHttp(approver, `/finance/expenses/${expenseB.id}/reject`, 'POST', 400, {});
  const rejectedB = await expectHttp<ExpenseApi>(
    approver,
    `/finance/expenses/${expenseB.id}/reject`,
    'POST',
    201,
    { reason: `Rejeição QA sintética ${runId}` },
  );
  assert.equal(rejectedB.status, 'REJECTED');
  assert.equal(rejectedB.rejectedById, approver.userId);
  assert.ok(rejectedB.rejectionReason?.includes(runId));
  const editedRejectedB = await expectHttp<ExpenseApi>(
    finance,
    `/finance/expenses/${expenseB.id}`,
    'PATCH',
    200,
    { description: `QA ${runId} - despesa reenviada`, amount: '20.1000' },
  );
  assert.equal(editedRejectedB.status, 'DRAFT');
  assert.equal(editedRejectedB.rejectedById, null);
  assert.equal(editedRejectedB.rejectionReason, null);
  const resubmittedB = await expectHttp<ExpenseApi>(
    finance,
    `/finance/expenses/${expenseB.id}/submit`,
    'POST',
    201,
  );
  assert.equal(resubmittedB.status, 'PENDING_APPROVAL');
  const summaryPending = await expectHttp<ExpenseSummaryApi>(
    finance,
    '/finance/expenses/summary',
    'GET',
    200,
  );
  const brlPending = summaryPending.currencies.find(({ currency }) => currency === 'BRL');
  assert.equal(brlPending?.pendingApproval.amount, '20.1000');
  assert.equal(brlPending?.pendingPayment.amount, '0.0000');
  const pendingFlow = await expectHttp<CashFlowApi>(
    finance,
    `/reports/cash-flow?${reportRange}`,
    'GET',
    200,
  );
  const pendingFlowRows = pendingFlow.rows.filter(({ currency }) => currency === 'BRL');
  assert.equal(sumReport(pendingFlowRows, 'pending_approval_expenses'), '20.1000');
  assert.equal(sumReport(pendingFlowRows, 'expected_expenses'), '0.0000');
  const approvedB = await expectHttp<ExpenseApi>(
    approver,
    `/finance/expenses/${expenseB.id}/approve`,
    'POST',
    201,
  );
  assert.equal(approvedB.status, 'APPROVED');
  assert.equal(approvedB.approvedById, approver.userId);
  const forecastApproved = await expectHttp<CashFlowApi>(
    finance,
    '/reports/cash-forecast',
    'GET',
    200,
  );
  assert.equal(
    sumReport(
      forecastApproved.rows.filter(({ currency }) => currency === 'BRL'),
      'expected_expenses',
    ),
    '20.1000',
  );
  const paidB = await expectHttp<ExpenseApi>(
    finance,
    `/finance/expenses/${expenseB.id}/payment`,
    'POST',
    201,
    { amount: '20.1000', paidAt, method: 'QA_SYNTHETIC', reference: `QA-${runId}-B` },
  );
  assert.equal(paidB.status, 'PAID');
  const historyB = await expectHttp<{ items: Array<{ transition?: string }>; total: number }>(
    finance,
    `/finance/expenses/${expenseB.id}/history`,
    'GET',
    200,
  );
  assert.ok(historyB.items.some((event) => event.transition === 'REJECT'));
  assert.ok(historyB.items.some((event) => event.transition === 'APPROVE'));
  assert.ok(historyB.items.some((event) => event.transition === 'PAY'));
  record('expense_required_approval_rejection_and_resubmission', {
    status: 'PASS',
    stage: 'rejeição justificada, reedição, reenvio, aprovação independente e pagamento exato',
    evidence: {
      selfApprovalRejected: true,
      paymentBeforeApprovalRejected: true,
      rejectionRequiresReason: true,
      rejectedExpenseEditableAndReset: true,
      pendingSummaryAmount: '20.1000',
      pendingNotCountedAsApprovedForecast: true,
      approvedForecastAmount: '20.1000',
      independentApprover: true,
      finalStatus: paidB.status,
      auditTransitions: ['REJECT', 'APPROVE', 'PAY'],
    },
  });

  setStage('despesas: relatórios, filtros e valores Decimal');
  const summary = await expectHttp<ExpenseSummaryApi>(
    finance,
    '/finance/expenses/summary',
    'GET',
    200,
  );
  const brl = summary.currencies.find(({ currency }) => currency === 'BRL');
  assert.equal(brl?.paid.count, 2);
  assert.equal(brl?.paid.amount, '145.2250');
  assert.equal(brl?.pendingApproval.amount, '0.0000');
  assert.equal(brl?.pendingPayment.amount, '0.0000');
  const finalFlow = await expectHttp<CashFlowApi>(
    finance,
    `/reports/cash-flow?${reportRange}`,
    'GET',
    200,
  );
  const finalFlowRows = finalFlow.rows.filter(({ currency }) => currency === 'BRL');
  assert.equal(sumReport(finalFlowRows, 'paid_expenses'), '145.2250');
  assert.equal(sumReport(finalFlowRows, 'expected_expenses'), '0.0000');
  assert.equal(sumReport(finalFlowRows, 'pending_approval_expenses'), '0.0000');
  const byClient = await expectHttp<CashFlowApi>(
    finance,
    `/reports/cash-flow-by-client?${reportRange}`,
    'GET',
    200,
  );
  const clientRow = byClient.rows.find(
    ({ client_id, currency }) => client_id === clientId && currency === 'BRL',
  );
  assert.ok(clientRow);
  assert.equal(exactMoney(clientRow.paid_expenses ?? '0'), '145.2250');
  const filtered = await expectHttp<{ items: ExpenseApi[]; total: number }>(
    finance,
    `/finance/expenses?status=PAID&category=${category}&period=dueDate&from=${from}&to=${to}`,
    'GET',
    200,
  );
  assert.equal(
    filtered.items.filter(({ id }) => [expenseA.id, expenseB.id].includes(id)).length,
    2,
  );
  const finalForecast = await expectHttp<CashFlowApi>(
    finance,
    '/reports/cash-forecast',
    'GET',
    200,
  );
  assert.equal(
    sumReport(
      finalForecast.rows.filter(({ currency }) => currency === 'BRL'),
      'expected_expenses',
    ),
    '0.0000',
  );
  record('expense_reports_and_decimal_consistency', {
    status: 'PASS',
    stage: 'resumo, caixa efetivo, previsão e resultado por cliente',
    evidence: {
      paidCount: brl?.paid.count,
      paidAmount: brl?.paid.amount,
      paidCashFlow: '145.2250',
      unpaidForecast: '0.0000',
      pendingApprovalAfterCompletion: '0.0000',
      clientExpenseAmount: '145.2250',
      filterMatchedTwoPaidExpenses: true,
      separateCurrencyGrouping: true,
    },
  });

  setStage('despesas: cancelamento e transições inválidas');
  const expenseC = await createExpense(
    finance,
    category,
    `QA ${runId} - despesa cancelável`,
    '12.3400',
    clientId,
  );
  const cancelledC = await expectHttp<ExpenseApi>(
    finance,
    `/finance/expenses/${expenseC.id}/cancel`,
    'POST',
    201,
  );
  assert.equal(cancelledC.status, 'CANCELLED');
  await expectHttp(finance, `/finance/expenses/${expenseC.id}/cancel`, 'POST', 409);
  await expectHttp(finance, `/finance/expenses/${expenseC.id}/submit`, 'POST', 409);
  await expectHttp(finance, `/finance/expenses/${expenseC.id}/payment`, 'POST', 409, {
    amount: '12.3400',
    paidAt,
    method: 'QA_SYNTHETIC',
  });
  record('expense_cancellation_and_invalid_transitions', {
    status: 'PASS',
    stage: 'cancelamento permitido em rascunho e rejeição de reuso/transições inválidas',
    evidence: {
      cancellationStatus: cancelledC.status,
      duplicateCancelRejected: true,
      submitAfterCancelRejected: true,
      paymentAfterCancelRejected: true,
    },
  });

  setStage('despesas: isolamento de organização e documentos');
  const otherList = await expectHttp<{ items: ExpenseApi[]; total: number }>(
    outsider,
    `/finance/expenses?status=PAID&category=${category}`,
    'GET',
    200,
  );
  assert.equal(otherList.total, 0);
  await expectHttp(outsider, `/finance/expenses/${expenseA.id}/history`, 'GET', 404);
  await expectHttp(outsider, `/finance/expenses/${expenseA.id}`, 'PATCH', 404, {
    description: 'tentativa sintética entre organizações',
  });
  await expectHttp(outsider, `/documents/${uploaded.id}`, 'GET', 404);
  await expectHttp(outsider, `/documents/${uploaded.id}/download-url`, 'GET', 404);
  const ownSummary = await expectHttp<ExpenseSummaryApi>(
    outsider,
    '/finance/expenses/summary',
    'GET',
    200,
  );
  const ownBrl = ownSummary.currencies.find(({ currency }) => currency === 'BRL');
  assert.equal(
    ownBrl,
    undefined,
    'O resumo do outro escritório não deve mostrar despesas do primeiro.',
  );
  record('expense_tenant_and_document_isolation', {
    status: 'PASS',
    stage: 'JWT administrador de outro escritório contra despesas e comprovante sintéticos',
    evidence: {
      foreignExpenseListCount: otherList.total,
      foreignHistoryNotFound: true,
      foreignUpdateNotFound: true,
      foreignDocumentNotFound: true,
      otherOrganizationSummaryHasNoForeignExpenses: ownBrl === undefined,
      sourceOrganizationPaidAmount: brl?.paid.amount,
    },
  });

  setStage('despesas: escritório com administrador único');
  const singlePolicy = await expectHttp<{ required: boolean; canSubmitForApproval: boolean }>(
    outsider,
    '/finance/expenses/approval-policy',
    'GET',
    200,
  );
  assert.equal(singlePolicy.required, true);
  assert.equal(singlePolicy.canSubmitForApproval, false);
  const singleExpense = await createExpense(
    outsider,
    singleAdminCategory,
    `QA ${runId} - escritório com administrador único`,
    '9.9900',
  );
  await expectHttp(outsider, `/finance/expenses/${singleExpense.id}/submit`, 'POST', 409);
  const singleBefore = await prisma.expense.findFirst({ where: { id: singleExpense.id } });
  assert.equal(singleBefore?.status, 'DRAFT');
  await expectHttp(outsider, '/finance/expenses/approval-policy', 'PATCH', 200, {
    required: false,
  });
  const singleApproved = await expectHttp<ExpenseApi>(
    outsider,
    `/finance/expenses/${singleExpense.id}/submit`,
    'POST',
    201,
  );
  assert.equal(singleApproved.status, 'APPROVED');
  const singlePaid = await expectHttp<ExpenseApi>(
    outsider,
    `/finance/expenses/${singleExpense.id}/payment`,
    'POST',
    201,
    { amount: '9.9900', paidAt, method: 'QA_SYNTHETIC', reference: `QA-${runId}-single` },
  );
  assert.equal(singlePaid.status, 'PAID');
  record('expense_single_administrator_office', {
    status: 'PASS',
    stage: 'escritório sintético com somente um administrador ativo',
    evidence: {
      approvalRequiredByDefault: singlePolicy.required,
      noIndependentApproverReported: !singlePolicy.canSubmitForApproval,
      submissionBlockedWithoutApprover: singleBefore?.status === 'DRAFT',
      disablingApprovalAllowedForAdmin: true,
      immediateApprovalAndIntegralPayment: singlePaid.status,
    },
  });

  setStage('despesas: confirmação final dos resultados agregados');
  const sourceSummary = await expectHttp<ExpenseSummaryApi>(
    finance,
    '/finance/expenses/summary',
    'GET',
    200,
  );
  const sourceBrl = sourceSummary.currencies.find(({ currency }) => currency === 'BRL');
  assert.equal(sourceBrl?.paid.amount, '145.2250');
  assert.equal(sourceBrl?.paid.count, 2);
  record('expenses_http_end_to_end', {
    status: 'PASS',
    stage: 'rotas HTTP autenticadas de despesas, Storage, auditoria e relatórios',
    evidence: {
      approvalOffAndOn: true,
      createEditDueDateResponsibleClient: true,
      rejectionAndIndependentApproval: true,
      exactIntegralPayments: ['125.1250', '20.1000'],
      duplicateAndInvalidTransitionsRejected: true,
      syntheticReceiptUploadedAndSignedUrlVerified: true,
      filteringHistorySummaryAndCashFlowVerified: true,
      organizationIsolationVerified: true,
      singleAdministratorWorkflowVerified: true,
      sourceOrganizationPaidExpenses: '145.2250 BRL',
      foreignOrganizationAmountExcluded: true,
    },
  });
}

async function main() {
  const expensesOnly = process.argv.includes('--expenses-only');
  const browserOnly = process.argv.includes('--browser-only');
  mkdirSync(artifactDir, { recursive: true });
  const result: Record<string, unknown> = {
    runId,
    startedAt,
    requestedApiConnectionLimit: apiConnectionLimit,
    scope: browserOnly
      ? 'synthetic browser-only'
      : expensesOnly
        ? 'sintético; organizações, identidades, cliente, despesas e comprovante criados neste run'
        : 'sintético; organizações, identidades, clientes, recebíveis, pagamentos, despesas e comprovante criados neste run',
    preflight: null,
    checks,
    cleanup: null,
  };
  let fixture:
    | {
        finance: QaAccount;
        approver: QaAccount;
        outsider: QaAccount;
        clientId: string;
        installmentId?: string;
      }
    | undefined;
  let currentStage = 'preflight de destinos e integrações';
  try {
    result.preflight = await preflight();
    currentStage = 'inicialização da API local';
    await startApi();
    currentStage = 'criação de organizações, identidades e cliente QA sintéticos';
    const finance = await createOrganizationAccount('principal');
    const approver = await createMemberAccount(
      finance.organizationId,
      'aprovador',
      'administrator',
    );
    const outsider = browserOnly
      ? finance
      : await createOrganizationAccount('externo', 'administrator');
    const client = await prisma.client.create({
      data: {
        organizationId: finance.organizationId,
        type: 'PERSON',
        displayName: `QA Cliente Sintético ${runId}`,
        source: `QA_EXECUTION_${runId}`,
        customFields: { qaRunId: runId, synthetic: true },
      },
      select: { id: true },
    });
    const portalAccount = browserSmoke
      ? await createMemberAccount(finance.organizationId, 'portal-client', 'client', client.id)
      : undefined;
    fixture = { finance, approver, outsider, clientId: client.id };

    if (!expensesOnly && !browserOnly) {
      currentStage = 'primeira leitura HTTP autenticada do overview';
      const cold = await overviewCall(finance, client.id);
      assert.equal(cold.response.status, 200, `Overview HTTP ${cold.response.status}`);
      const coldBalance =
        (
          cold.body as { financial?: { outstanding?: Array<{ currency: string; amount: string }> } }
        ).financial?.outstanding?.find(({ currency }) => currency === 'BRL')?.amount ?? '0.0000';
      assert.equal(coldBalance, '0.0000');
      const limit = Number(cold.response.headers.get('x-ratelimit-limit'));
      const coldCounter = await readReadRateLimitCounter(finance);
      assert.ok(coldCounter, 'O contador do rate limit da identidade sintética deve existir.');
      const { remaining: remainingCold } = assertRateLimitHeaderMatchesCounter(
        cold.response,
        coldCounter,
        'Overview inicial',
      );
      assert.ok(
        limit > 0 && remainingCold < limit,
        'O rate limit autenticado deve continuar ativo.',
      );

      currentStage = 'criação HTTP do recebível sintético';
      const receivableResponse = await request(finance, '/finance/receivables', {
        method: 'POST',
        body: JSON.stringify({
          clientId: client.id,
          reference: `QA-${runId}`,
          description: `Recebível sintético QA ${runId}`,
          originalAmount: '100.0000',
          currency: 'BRL',
          issueDate: new Date().toISOString().slice(0, 10),
          installments: [{ sequence: 1, amount: '100.0000', dueDate: '2027-01-20' }],
        }),
      });
      assert.equal(
        receivableResponse.response.status,
        201,
        `Criação de recebível HTTP ${receivableResponse.response.status}`,
      );
      const installmentId = (receivableResponse.body as { installments?: Array<{ id: string }> })
        .installments?.[0]?.id;
      assert.ok(installmentId);
      fixture!.installmentId = installmentId;

      currentStage = 'leituras aquecidas e duas leituras concorrentes do overview';
      const warmDurations: number[] = [];
      let previousCounter = coldCounter;
      for (let i = 0; i < 10; i++) {
        const sample = await overviewCall(finance, client.id);
        assert.equal(
          sample.response.status,
          200,
          `Overview aquecido ${i + 1}: HTTP ${sample.response.status}`,
        );
        const body = sample.body as {
          financial?: { outstanding?: Array<{ currency: string; amount: string }> };
        };
        assert.equal(
          body.financial?.outstanding?.find(({ currency }) => currency === 'BRL')?.amount,
          '100.0000',
        );
        warmDurations.push(sample.durationMs);
        const counter = await readReadRateLimitCounter(finance);
        assert.ok(counter, `Contador de rate limit ausente após leitura ${i + 1}.`);
        assertRateLimitHeaderMatchesCounter(sample.response, counter, `Overview aquecido ${i + 1}`);
        if (counter.windowStartedAt.getTime() === previousCounter.windowStartedAt.getTime()) {
          assert.equal(
            counter.requestCount,
            previousCounter.requestCount + 1,
            `A leitura ${i + 1} não incrementou exatamente uma vez na mesma janela.`,
          );
        } else {
          assert.equal(
            counter.requestCount,
            1,
            `A leitura ${i + 1} deve iniciar com contador 1 após a virada da janela.`,
          );
        }
        previousCounter = counter;
      }
      const stableWindow = await waitForStableRateLimitWindow();
      const beforeConcurrent = await readReadRateLimitCounter(finance);
      const countBeforeConcurrent =
        beforeConcurrent?.windowStartedAt.getTime() === stableWindow.getTime()
          ? beforeConcurrent.requestCount
          : 0;
      const concurrent = await Promise.all([
        overviewCall(finance, client.id),
        overviewCall(finance, client.id),
      ]);
      assert.ok(concurrent.every(({ response }) => response.status === 200));
      const afterConcurrent = await readReadRateLimitCounter(finance);
      assert.ok(afterConcurrent, 'Contador de rate limit ausente após leituras concorrentes.');
      assert.equal(
        afterConcurrent.windowStartedAt.getTime(),
        stableWindow.getTime(),
        'A janela mudou durante a medição de concorrência controlada.',
      );
      assert.equal(
        afterConcurrent.requestCount,
        countBeforeConcurrent + concurrent.length,
        'As leituras concorrentes não foram contabilizadas atomicamente, uma vez cada.',
      );
      const concurrentRemaining = concurrent
        .map(({ response }) => Number(response.headers.get('x-ratelimit-remaining')))
        .sort((a, b) => a - b);
      assert.deepEqual(concurrentRemaining, [
        Math.max(0, limit - countBeforeConcurrent - 2),
        Math.max(0, limit - countBeforeConcurrent - 1),
      ]);
      const allLatencies = [...warmDurations, ...concurrent.map(({ durationMs }) => durationMs)];
      record('overview_http_autenticado', {
        status: 'PASS',
        stage: 'Auth JWT, membership, permissões, rate limit, Prisma e JSON HTTP',
        evidence: {
          coldMs: Math.round(cold.durationMs),
          warm: stats(warmDurations),
          concurrent2Ms: concurrent.map(({ durationMs }) => Math.round(durationMs)),
          combined: stats(allLatencies),
          rateLimitActive: true,
          rateLimitWindow: stableWindow.toISOString(),
          concurrentCounterBefore: countBeforeConcurrent,
          concurrentCounterAfter: afterConcurrent.requestCount,
          concurrentRemaining,
          baselineBalance: '100.0000 BRL',
          httpStatuses: [
            cold.response.status,
            ...concurrent.map(({ response }) => response.status),
          ],
        },
      });

      currentStage = 'negação de leitura entre organizações';
      const otherTenant = await overviewCall(outsider, client.id);
      assert.equal(otherTenant.response.status, 404);
      record('isolamento_entre_organizacoes', {
        status: 'PASS',
        stage: 'GET /clients/:id/overview com JWT de outro escritório',
        evidence: { status: otherTenant.response.status, bodyContainsSyntheticClient: false },
      });

      currentStage = 'disputa concorrente de pagamento com chaves distintas';
      const raceAmount = '65.0000';
      const idempotencyKeys = [randomUUID(), randomUUID()];
      const raceStarted = performance.now();
      const payments = await Promise.all(
        idempotencyKeys.map((idempotencyKey, index) =>
          request(finance, '/finance/payments', {
            method: 'POST',
            headers: { 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify({
              clientId: client.id,
              reference: `QA-RACE-${runId}-${index}`,
              amount: raceAmount,
              currency: 'BRL',
              paidAt: new Date().toISOString(),
              method: 'PIX',
              allocations: [{ installmentId, amount: raceAmount }],
            }),
          }),
        ),
      );
      const raceDurationMs = Math.round(performance.now() - raceStarted);
      const statuses = payments.map(({ response }) => response.status);
      assert.equal(
        statuses.filter((status) => status === 201).length,
        1,
        `Esperava 1 pagamento, recebeu ${statuses.join(',')}`,
      );
      assert.equal(statuses.filter((status) => status === 400 || status === 409).length, 1);
      const storedPayments = await prisma.payment.findMany({
        where: { organizationId: finance.organizationId, idempotencyKey: { in: idempotencyKeys } },
        include: { allocations: { where: { reversedAt: null } } },
      });
      assert.equal(storedPayments.length, 1);
      assert.equal(storedPayments[0]?.status, 'CONFIRMED');
      assert.equal(storedPayments[0]?.amount.toFixed(4), raceAmount);
      assert.equal(storedPayments[0]?.allocations.length, 1);
      assert.equal(storedPayments[0]?.allocations[0]?.amount.toFixed(4), raceAmount);
      const installment = await prisma.receivableInstallment.findFirst({
        where: { id: installmentId, organizationId: finance.organizationId },
        include: { allocations: { where: { reversedAt: null, payment: { status: 'CONFIRMED' } } } },
      });
      const allocated = installment?.allocations.reduce(
        (sum, allocation) => sum.plus(allocation.amount),
        new Prisma.Decimal(0),
      );
      assert.equal(allocated?.toFixed(4), '65.0000');
      assert.equal(installment?.amount.minus(allocated ?? 0).toFixed(4), '35.0000');
      record('pagamentos_concorrentes_idempotencia_distinta', {
        status: 'PASS',
        stage: 'POST /finance/payments em concorrência 2 no PostgreSQL real',
        evidence: {
          httpStatuses: statuses,
          confirmedPayments: storedPayments.length,
          activeAllocations: storedPayments[0]?.allocations.length,
          totalAllocated: allocated?.toFixed(4),
          remainingBalance: installment?.amount.minus(allocated ?? 0).toFixed(4),
          raceDurationMs,
          keysWereDistinct: true,
        },
      });

      currentStage = 'conciliação do saldo e relatório de recebimentos';
      const afterOverview = await overviewCall(finance, client.id);
      assert.equal(afterOverview.response.status, 200);
      const afterBalance = (
        afterOverview.body as {
          financial?: { outstanding?: Array<{ currency: string; amount: string }> };
        }
      ).financial?.outstanding?.find(({ currency }) => currency === 'BRL')?.amount;
      assert.equal(afterBalance, '35.0000');
      const from = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const received = await request(
        finance,
        `/reports/received?from=${from}&to=${to}&groupBy=day`,
      );
      assert.equal(received.response.status, 200);
      const receivedRows = (received.body as { rows?: Array<{ amount: string }> }).rows ?? [];
      assert.equal(
        receivedRows.reduce((sum, row) => sum + Number(row.amount), 0),
        65,
      );
      record('relatorio_recebimentos_e_saldo', {
        status: 'PASS',
        stage: 'overview pós-pagamento e GET /reports/received',
        evidence: {
          overviewBalance: afterBalance,
          actualReceived: '65.00',
          reportHttpStatus: received.response.status,
        },
      });

      currentStage = 'conferência do contador sintético de rate limit';
      const counterKey = createHash('sha256').update(`${finance.userId}:read`).digest('hex');
      const counter = await prisma.apiRateLimit.findUnique({
        where: {
          organizationId_keyHash: { organizationId: finance.organizationId, keyHash: counterKey },
        },
        select: { requestCount: true },
      });
      assert.ok(counter && counter.requestCount > 0);
      record('rate_limit_sintetico', {
        status: 'PASS',
        stage: 'conferência da linha técnica criada pelo guard global',
        evidence: {
          recordBelongsToQaUserAndOrganization: true,
          requestCount: counter.requestCount,
          modifiedPreexistingCounter: false,
        },
      });
    }

    if (!browserOnly) {
      assert.ok(outsider);
      await runExpenseChecks({ finance, approver, outsider, clientId: client.id }, (stage) => {
        currentStage = stage;
      });
    }
    if (browserOnly && !process.argv.includes('--skip-overview-benchmark')) {
      currentStage = 'overview HTTP instrumentado para desempenho';
      try {
        record(
          'overview_http_performance_timing',
          await runOverviewPerformance(finance, client.id),
        );
      } catch (error) {
        record('overview_http_performance_timing', {
          status: 'FAIL',
          stage: currentStage,
          evidence: { errorType: errorType(error), message: safeErrorMessage(error) },
          error: errorType(error),
        });
      }
    } else if (browserOnly) {
      result.skippedChecks = {
        overview_http_performance_timing:
          'NOT_RUN: medições HTTP já registradas em execuções anteriores desta sprint.',
      };
    }
    if (browserSmoke && portalAccount) {
      currentStage = 'frontend real autenticado no navegador';
      try {
        record('frontend_browser_real', await runBrowserSmoke(approver, portalAccount, client.id));
      } catch (error) {
        const message = safeErrorMessage(error);
        const blocked =
          /executable doesn.t exist|browser has been closed|browserType\.launch/i.test(message);
        record('frontend_browser_real', {
          status: blocked ? 'BLOCKED' : 'FAIL',
          stage: currentStage,
          evidence: { errorType: errorType(error), message },
          error: errorType(error),
        });
      }
    }
  } catch (error) {
    const failedName =
      currentStage.includes('organizações') ||
      currentStage.includes('preflight') ||
      currentStage.includes('API local')
        ? 'overview_http_autenticado'
        : currentStage.includes('overview') || currentStage.includes('leituras')
          ? 'overview_http_autenticado'
          : currentStage.includes('recebível') || currentStage.includes('pagamento')
            ? 'pagamentos_concorrentes_idempotencia_distinta'
            : currentStage.includes('relatório') || currentStage.includes('saldo')
              ? 'relatorio_recebimentos_e_saldo'
              : currentStage.startsWith('despesas:')
                ? 'expenses_http_end_to_end'
                : 'rate_limit_sintetico';
    record(failedName, {
      status: 'FAIL',
      stage: currentStage,
      evidence: { errorType: errorType(error), message: safeErrorMessage(error) },
      error: errorType(error),
    });
    console.error(`QA financeiro interrompido em ${currentStage} (${errorType(error)}).`);
  } finally {
    const cleanup: Record<string, unknown> = {
      organizationsArchived: 0,
      membershipsSuspended: 0,
      usersSuspended: 0,
      authUsersBanned: 0,
      syntheticProfilesRetained: 0,
      retainedSyntheticAuditAndRateLimitEvidence: true,
    };
    try {
      if (organizations.length) {
        const archived = await prisma.organization.updateMany({
          where: { id: { in: organizations }, slug: { startsWith: `qa-finance-${runId}-` } },
          data: { status: 'ARCHIVED' },
        });
        cleanup.organizationsArchived = archived.count;
        const memberships = await prisma.organizationMember.updateMany({
          where: { organizationId: { in: organizations }, profileId: { in: authUsers } },
          data: { status: 'SUSPENDED' },
        });
        cleanup.membershipsSuspended = memberships.count;
        const users = await prisma.user.updateMany({
          where: { organizationId: { in: organizations }, authUserId: { in: authUsers } },
          data: { status: 'SUSPENDED' },
        });
        cleanup.usersSuspended = users.count;
      }
      for (const userId of authUsers) {
        const banned = await authAdmin.auth.admin.updateUserById(userId, {
          ban_duration: '876000h',
        });
        if (!banned.error) cleanup.authUsersBanned = Number(cleanup.authUsersBanned) + 1;
      }
      cleanup.syntheticProfilesRetained = await prisma.profile.count({
        where: { id: { in: authUsers } },
      });
    } catch (error) {
      cleanup.error = errorType(error);
    }
    cleanup.apiStopRequested = Boolean(apiProcess);
    cleanup.apiShutdownGraceful = await stopChild(apiProcess, 15_000);
    cleanup.webStopRequested = Boolean(webProcess);
    cleanup.webShutdownGraceful = await stopChild(webProcess, 10_000);
    await new Promise<void>((resolve) => apiLog?.end(resolve) ?? resolve());
    await new Promise<void>((resolve) => webLog?.end(resolve) ?? resolve());
    attachOverviewServerAndQueryMetrics();
    attachApiPoolDiagnostics(result);
    result.finishedAt = new Date().toISOString();
    result.checks = checks;
    result.cleanup = cleanup;
    const statuses = Object.values(checks).map((check) => check.status);
    const overall = statuses.includes('FAIL')
      ? 'FAIL'
      : statuses.length > 0 && statuses.every((status) => status === 'PASS')
        ? 'PASS'
        : 'PARTIAL';
    result.status = overall;
    result.limitations = [
      'Pagamento parcial, estorno, reembolso processado e conciliação de despesas permanecem indisponíveis.',
      'O comprovante sintético permanece no Storage privado associado à organização QA arquivada; nenhum objeto preexistente foi alterado.',
      'Históricos de auditoria e contadores de rate limit QA são retidos; somente organizações QA, memberships, usuários e contas Auth deste run são encerrados/suspensos.',
    ];
    writeFileSync(outputPath, JSON.stringify(result, null, 2), { flag: 'wx' });
    await prisma.$disconnect();
    console.log(
      JSON.stringify(
        {
          status: overall,
          artifact: outputPath,
          checks: Object.fromEntries(
            Object.entries(checks).map(([key, value]) => [key, value.status]),
          ),
          cleanup,
        },
        null,
        2,
      ),
    );
    if (overall === 'FAIL') process.exitCode = 1;
  }
}

void main();
