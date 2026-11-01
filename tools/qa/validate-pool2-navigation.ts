import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Prisma, PrismaClient } from '@livio/db';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect, type BrowserContext, type Page, type Request } from '@playwright/test';

const projectRef = 'ioebcdpyrszokdyaoaqv';
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Defina ${name} para validar navegação QA.`);
  return value;
};
const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const artifactDir =
  process.env.QA_ARTIFACT_DIR ?? 'docs/auditoria-2026-10-27/evidencias-navegacao-pool2';
const outputPath = join(artifactDir, `qa-navigation-pool2-${runId}.json`);
const apiLogPath = join(artifactDir, `qa-navigation-api-${runId}.log`);
const webLogPath = join(artifactDir, `qa-navigation-web-${runId}.log`);
const databaseUrl = new URL(required('DATABASE_URL'));
const apiDatabaseUrl = new URL(databaseUrl);
apiDatabaseUrl.searchParams.set('connection_limit', '2');
apiDatabaseUrl.searchParams.set(
  'pool_timeout',
  databaseUrl.searchParams.get('pool_timeout') ?? '10',
);
const supabaseUrl = new URL(required('SUPABASE_URL'));
const anonKey = required('SUPABASE_ANON_KEY');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
const maxWaitersBeforeStop = 4;
const moduleTimeoutMs = 10_000;
const idleTimeoutMs = 7_000;
const scenarioTimeoutMs = 65_000;
const isolatedApiCwd = mkdtempSync(join(tmpdir(), 'livio-qa-pool2-api-'));

assert.equal(process.env.QA_ALLOW_REAL_SYNTHETIC_NAVIGATION, 'true');
assert.equal(process.env.QA_PROJECT_REF, projectRef);
assert.equal(process.env.CONFIRM_SUPABASE_PROJECT_REF, projectRef);
assert.equal(process.env.SUPABASE_PROJECT_REF, projectRef);
assert.equal(process.env.PRODUCTION_SUPABASE_PROJECT_REF, projectRef);
assert.equal(supabaseUrl.hostname, `${projectRef}.supabase.co`);
assert.equal(databaseUrl.port, '6543');
assert.equal(databaseUrl.searchParams.get('pgbouncer'), 'true');
assert.equal(
  databaseUrl.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(databaseUrl.username).includes(projectRef),
  true,
);
assert.equal(new URL(required('NEXT_PUBLIC_SUPABASE_URL')).origin, supabaseUrl.origin);
assert.equal(required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), anonKey);
assert.equal(process.env.QA_API_CONNECTION_LIMIT, '2');
assert.equal(existsSync(join(isolatedApiCwd, '.env')), false);
assert.equal(existsSync(resolve(isolatedApiCwd, '../../.env')), false);

const externalCredentialNames = Object.keys(process.env).filter(
  (name) =>
    /^(SMTP_|EMAIL_|MAIL_|RESEND_|SENDGRID_|MAILGUN_|VAPID_|STRIPE_|PAYMENT_|MERCADOPAGO_|PAGARME_|PAGSEGURO_|ASAAS_|EFI_|WHATSAPP_|META_|WEBHOOK_)/i.test(
      name,
    ) || name === 'CRON_SECRET',
);
assert.deepEqual(
  externalCredentialNames,
  [],
  'Remova integrações externas do processo local antes do teste.',
);

const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Falha desconhecida.';
  return message
    .replace(/[A-Z0-9._%+-]+@(?:example\.(?:com|org|net|test|invalid)|localhost)/gi, '[email QA]')
    .replace(/(?:token_hash|access_token|refresh_token)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, '[DATABASE_URL redigida]')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '[JWT redigido]')
    .slice(0, 240);
};

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted.length ? (sorted[Math.ceil(p * sorted.length) - 1] ?? 0) : null;
  return {
    samples: sorted.length,
    p50Ms: percentile(0.5) === null ? null : Math.round(percentile(0.5) ?? 0),
    p95Ms: percentile(0.95) === null ? null : Math.round(percentile(0.95) ?? 0),
    maxMs: sorted.length ? Math.round(sorted.at(-1) ?? 0) : null,
  };
}

function normalizeApiPath(url: string) {
  const path = new URL(url).pathname;
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function parseServerTiming(value: string | undefined) {
  if (!value) return {};
  return Object.fromEntries(
    value.split(',').flatMap((part) => {
      const match = part.trim().match(/^([a-zA-Z0-9_-]+);dur=([\d.]+)$/);
      return match ? [[match[1]!, Number(match[2])]] : [];
    }),
  );
}

async function allocatePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForProcessReady(
  processHandle: ChildProcess,
  url: string,
  maxWaitMs: number,
  acceptableStatuses: number[] = [200],
) {
  const deadline = Date.now() + maxWaitMs;
  let lastStatus: number | undefined;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null)
      throw new Error(
        `Processo local encerrou antes de ficar pronto (exit ${processHandle.exitCode}).`,
      );
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      lastStatus = response.status;
      if (acceptableStatuses.includes(response.status)) return;
    } catch {
      // Keep the retry bounded by deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Serviço local não ficou pronto no prazo (último HTTP ${lastStatus ?? 'sem resposta'}).`,
  );
}

async function stopProcess(processHandle: ChildProcess | undefined) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.killed) return;
  processHandle.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => processHandle.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
}

type Candidate = {
  authId: string;
  userId: string;
  organizationId: string;
  email: string;
  permissions: string[];
};

type RouteResult = {
  session: number;
  scenario: string;
  module: string;
  method: string;
  route: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status?: number;
  serverTiming?: Record<string, number>;
  failure?: 'ABORTED' | 'NETWORK_ERROR';
  failureReason?: string;
};

type BrowserSession = {
  index: number;
  page: Page;
  context: BrowserContext;
  activeModule: string;
  pending: Set<Request>;
  requestState: Map<Request, RouteResult>;
  lastApiActivityAt: number;
  pageErrors: number;
  consoleErrors: string[];
  webFailures: string[];
};

type ScenarioRuntime = {
  name: string;
  startAt: number;
  fatalReason?: string;
  sessions: BrowserSession[];
  maxOutstanding?: number;
};

const requestRows: RouteResult[] = [];
const poolSamples: Array<{
  time: number;
  waiting: number;
  busy: number;
  open: number;
  waitSumMs: number;
}> = [];
const p2024Times: number[] = [];
const apiQueryEvents: Array<{
  time: number;
  durationMs: number;
  operation: string;
  tables: string[];
  signature: string;
}> = [];
const projectSummary = {
  ref: projectRef,
  localDatabaseHost: databaseUrl.hostname,
  localDatabasePort: databaseUrl.port,
  localPoolerMode: 'Supavisor transaction pooler',
  apiConnectionLimit: 2,
  poolTimeoutSeconds: Number(apiDatabaseUrl.searchParams.get('pool_timeout') ?? '10'),
  businessTables: {} as Record<string, number>,
  technicalCountsBefore: {} as Record<string, number>,
  technicalCountsAfter: {} as Record<string, number>,
  databaseLimits: {} as Record<string, number | string>,
  accountRole: 'administrator',
  accountAndOrganizationSynthetic: true,
  existingOrganizationReused: true,
  newOrganizationCreated: false,
  newBusinessRecordsCreated: false,
  browserAuthTransport: {} as Record<string, unknown>,
  initialPageState: {} as Record<string, unknown>,
};

const apiAdmin = createClient(supabaseUrl.origin, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let apiProcess: ChildProcess | undefined;
let webProcess: ChildProcess | undefined;
let apiLog: WriteStream | undefined;
let webLog: WriteStream | undefined;
let currentScenario: ScenarioRuntime | undefined;
let apiUrl = '';
let webUrl = '';
let webLogPending = '';
let apiLogPending = '';

function appendWebLog(chunk: Buffer | string) {
  if (!webLog) return;
  webLogPending += chunk.toString();
  const lines = webLogPending.split(/\r?\n/);
  webLogPending = lines.pop() ?? '';
  for (const line of lines) {
    const safe = line
      .replace(/(token_hash|access_token|refresh_token|otp)=([^&\s]+)/gi, '$1=[REDACTED]')
      .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '[JWT redigido]');
    webLog.write(`${safe}\n`);
  }
}

function parseApiLogLine(line: string) {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  if (event.event === 'prisma_pool_sample' && typeof event.waiting === 'number') {
    const waitHistogram =
      typeof event.waitHistogram === 'object' && event.waitHistogram !== null
        ? (event.waitHistogram as { sum?: number })
        : {};
    poolSamples.push({
      time: Number(event.time ?? Date.now()),
      waiting: event.waiting,
      busy: Number(event.busy ?? 0),
      open: Number(event.open ?? 0),
      waitSumMs: Number(waitHistogram.sum ?? 0),
    });
    if (currentScenario && event.waiting >= maxWaitersBeforeStop) {
      signalScenarioFailure(`Pool Prisma chegou a ${event.waiting} consultas aguardando.`);
    }
  }
  if (
    event.event === 'prisma_query_timing' &&
    typeof event.time === 'number' &&
    typeof event.durationMs === 'number'
  ) {
    apiQueryEvents.push({
      time: event.time,
      durationMs: event.durationMs,
      operation: String(event.operation ?? 'OTHER'),
      tables: Array.isArray(event.tables) ? event.tables.map(String) : [],
      signature: String(event.signature ?? 'unknown'),
    });
  }
  if (line.includes('P2024')) {
    p2024Times.push(Date.now());
    if (currentScenario) signalScenarioFailure('A API registrou Prisma P2024.');
  }
}

function appendApiLog(chunk: Buffer | string) {
  if (!apiLog) return;
  apiLogPending += chunk.toString();
  const lines = apiLogPending.split(/\r?\n/);
  apiLogPending = lines.pop() ?? '';
  for (const line of lines) {
    parseApiLogLine(line);
    apiLog.write(`${line}\n`);
  }
}

function signalScenarioFailure(reason: string) {
  if (!currentScenario || currentScenario.fatalReason) return;
  currentScenario.fatalReason = reason;
  for (const session of currentScenario.sessions) void session.page.close().catch(() => undefined);
}

async function snapshotQaBusinessCounts(prisma: PrismaClient, organizationId: string) {
  const rows = await prisma.$queryRaw<Array<{ entity: string; count: number }>>(Prisma.sql`
    SELECT 'clients' AS entity, count(*)::int AS count FROM public.clients WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'client_contacts', count(*)::int FROM public.client_contacts WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'matters', count(*)::int FROM public.matters WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'contracts', count(*)::int FROM public.contracts WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'receivables', count(*)::int FROM public.receivables WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'installments', count(*)::int FROM public.receivable_installments WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'payments', count(*)::int FROM public.payments WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'payment_allocations', count(*)::int FROM public.payment_allocations WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'expenses', count(*)::int FROM public.expenses WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'documents', count(*)::int FROM public.documents WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'document_versions', count(*)::int FROM public.document_versions WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'tasks', count(*)::int FROM public.tasks WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'calendar_events', count(*)::int FROM public.calendar_events WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'notifications', count(*)::int FROM public.notifications WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'client_messages', count(*)::int FROM public.client_messages WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'matter_stage_history', count(*)::int FROM public.matter_stage_history WHERE organization_id=${organizationId}::uuid`);
  return Object.fromEntries(rows.map(({ entity, count }) => [entity, count]));
}

async function snapshotTechnicalCounts(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
) {
  const keys = {
    read: createHash('sha256').update(`${userId}:read`).digest('hex'),
    write: createHash('sha256').update(`${userId}:write`).digest('hex'),
  };
  const rows = await prisma.$queryRaw<Array<{ entity: string; count: number }>>(Prisma.sql`
    SELECT 'audit_logs' AS entity, count(*)::int AS count FROM public.audit_logs WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'activity_events', count(*)::int FROM public.activity_events WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'rate_limit_rows', count(*)::int FROM public.api_rate_limits WHERE organization_id=${organizationId}::uuid
    UNION ALL SELECT 'admin_read_counter', coalesce(sum(request_count),0)::int FROM public.api_rate_limits WHERE organization_id=${organizationId}::uuid AND key_hash=${keys.read}
    UNION ALL SELECT 'admin_write_counter', coalesce(sum(request_count),0)::int FROM public.api_rate_limits WHERE organization_id=${organizationId}::uuid AND key_hash=${keys.write}
    UNION ALL SELECT 'admin_read_current_window', coalesce(sum(request_count),0)::int FROM public.api_rate_limits WHERE organization_id=${organizationId}::uuid AND key_hash=${keys.read} AND window_started_at=date_trunc('minute',CURRENT_TIMESTAMP)
    UNION ALL SELECT 'admin_write_current_window', coalesce(sum(request_count),0)::int FROM public.api_rate_limits WHERE organization_id=${organizationId}::uuid AND key_hash=${keys.write} AND window_started_at=date_trunc('minute',CURRENT_TIMESTAMP)`);
  return Object.fromEntries(rows.map(({ entity, count }) => [entity, count]));
}

async function preflight() {
  const prisma = new PrismaClient();
  try {
    const [identity] = await prisma.$queryRaw<
      Array<{
        database: string;
        serverVersion: string;
        maxConnections: number;
        reservedConnections: number;
        visibleConnections: number;
        activeConnections: number;
      }>
    >`SELECT current_database() AS database,
             current_setting('server_version') AS "serverVersion",
             current_setting('max_connections')::int AS "maxConnections",
             current_setting('superuser_reserved_connections')::int AS "reservedConnections",
             (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS "visibleConnections",
             (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='active') AS "activeConnections"`;
    assert.ok(identity);
    projectSummary.databaseLimits = {
      database: identity.database,
      serverVersion: identity.serverVersion,
      maxConnections: identity.maxConnections,
      reservedConnections: identity.reservedConnections,
      visibleConnectionsBefore: identity.visibleConnections,
      activeConnectionsBefore: identity.activeConnections,
    };
    assert.ok(
      identity.visibleConnections < identity.maxConnections - identity.reservedConnections - 10,
      'Margem PostgreSQL observável ficou abaixo de dez conexões.',
    );

    const candidates = await prisma.$queryRaw<Candidate[]>(Prisma.sql`
      SELECT profile.id::text AS "authId", u.id::text AS "userId",
             o.id::text AS "organizationId", profile.email,
             array_agg(DISTINCT permission.resource || ':' || permission.action) AS permissions
        FROM public.organizations o
        JOIN public.organization_members m ON m.organization_id=o.id
        JOIN public.users u ON u.id=m.user_id
        JOIN public.profiles profile ON profile.id=m.profile_id
        JOIN public.organization_member_roles mr
          ON mr.organization_id=m.organization_id AND mr.membership_id=m.id
        JOIN public.roles role ON role.id=mr.role_id AND role.organization_id=o.id
        JOIN public.role_permissions rp ON rp.organization_id=role.organization_id AND rp.role_id=role.id
        JOIN public.permissions permission
          ON permission.organization_id=rp.organization_id AND permission.id=rp.permission_id
       WHERE (o.slug ILIKE 'qa-workflows-%' OR o.slug ~* '^(qa|test)[-_]')
         AND o.status='ACTIVE' AND m.status='ACTIVE' AND u.status='ACTIVE'
         AND role.key='administrator'
         AND (lower(split_part(profile.email,'@',2)) IN
               ('example.com','example.org','example.net','example.test','example.invalid','localhost','test')
              OR lower(split_part(profile.email,'@',2)) LIKE '%.test'
              OR lower(split_part(profile.email,'@',2)) LIKE '%.invalid'
              OR lower(split_part(profile.email,'@',2)) LIKE '%.example')
       GROUP BY profile.id, u.id, o.id, profile.email`);
    assert.equal(
      candidates.length,
      1,
      'Esperava uma única conta administradora QA ativa e sintética.',
    );
    const candidate = candidates[0]!;
    const requiredPermissions = [
      'reports:view',
      'clients:view',
      'matters:view',
      'expenses:view',
      'documents:view',
      'tasks:view',
    ];
    assert.ok(
      requiredPermissions.every((permission) => candidate.permissions.includes(permission)),
    );
    const activeUser = await apiAdmin.auth.admin.getUserById(candidate.authId);
    assert.ifError(activeUser.error);
    assert.equal(activeUser.data.user?.email?.toLowerCase(), candidate.email.toLowerCase());
    assert.ok(activeUser.data.user?.email_confirmed_at);
    const bannedUntil = activeUser.data.user?.banned_until;
    assert.ok(
      !bannedUntil || new Date(bannedUntil).getTime() <= Date.now(),
      'A conta sintética QA está banida no momento.',
    );

    const authSettingsResponse = await fetch(`${supabaseUrl.origin}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(authSettingsResponse.status, 200);
    const authSettings = (await authSettingsResponse.json()) as { disable_signup?: boolean };
    assert.equal(authSettings.disable_signup, true);
    const pushCount = await prisma.webPushSubscription.count({
      where: { organizationId: candidate.organizationId },
    });
    assert.equal(pushCount, 0, 'Há assinaturas push no tenant QA; não inicie teste de navegação.');

    projectSummary.businessTables = await snapshotQaBusinessCounts(
      prisma,
      candidate.organizationId,
    );
    projectSummary.technicalCountsBefore = await snapshotTechnicalCounts(
      prisma,
      candidate.organizationId,
      candidate.userId,
    );
    assert.ok(
      (projectSummary.technicalCountsBefore.admin_write_current_window ?? 0) <= 10,
      'Contador de escrita QA já consumiu a margem reservada para o teste; aguarde a próxima janela UTC.',
    );
    return candidate;
  } finally {
    await prisma.$disconnect();
  }
}

function startApi(apiPort: number, webOrigin: string) {
  apiLog = createWriteStream(apiLogPath, { flags: 'wx' });
  const childEnv = { ...process.env };
  for (const key of externalCredentialNames) delete childEnv[key];
  childEnv.API_PORT = String(apiPort);
  childEnv.DATABASE_URL = apiDatabaseUrl.toString();
  childEnv.QA_TIMINGS = 'true';
  childEnv.LOG_LEVEL = 'info';
  childEnv.NODE_ENV = 'development';
  childEnv.CORS_ORIGINS = webOrigin;
  apiProcess = spawn(process.execPath, [resolve('apps/api/dist/main.js')], {
    // O CWD temporário impede o ConfigModule de recarregar o .env da raiz e
    // reintroduzir SMTP, VAPID, cron ou outras credenciais removidas do filho.
    cwd: isolatedApiCwd,
    shell: false,
    windowsHide: true,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout?.on('data', appendApiLog);
  apiProcess.stderr?.on('data', appendApiLog);
  return apiProcess;
}

function startWeb(webPort: number, apiOrigin: string) {
  webLog = createWriteStream(webLogPath, { flags: 'wx' });
  const webEnv: NodeJS.ProcessEnv = {
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
    NEXT_PUBLIC_API_URL: `${apiOrigin}/v1`,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl.origin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  };
  webProcess = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'dev', 'apps/web', '-p', String(webPort)],
    {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      env: webEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  webProcess.stdout?.on('data', appendWebLog);
  webProcess.stderr?.on('data', appendWebLog);
  return webProcess;
}

async function createAuthenticatedSession(
  index: number,
  candidate: Candidate,
  organizationId: string,
  browserHandle: Awaited<ReturnType<typeof chromium.launch>>,
) {
  const context = await browserHandle.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(moduleTimeoutMs);
  page.setDefaultNavigationTimeout(15_000);
  const session: BrowserSession = {
    index,
    context,
    page,
    activeModule: 'Visão geral',
    pending: new Set(),
    requestState: new Map(),
    lastApiActivityAt: Date.now(),
    pageErrors: 0,
    consoleErrors: [],
    webFailures: [],
  };
  attachRequestObservation(session);
  page.on('pageerror', () => {
    session.pageErrors += 1;
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/content security policy|connect-src/i.test(text))
      session.consoleErrors.push('CSP_CONNECT_SRC');
    else if (/cors|cross-origin/i.test(text)) session.consoleErrors.push('CORS_ORIGIN');
    else session.consoleErrors.push('BROWSER_CONSOLE_ERROR');
  });

  await page.goto(webUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  const apiReachability = await page.evaluate(async (healthUrl) => {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
      return { status: response.status };
    } catch (error) {
      return { error: error instanceof Error ? error.name : 'fetch failed' };
    }
  }, `${apiUrl}/v1/health/ready`);
  assert.equal(
    apiReachability.status,
    200,
    `Browser não alcança a API local pelo origin/CSP configurado (${apiReachability.error ?? `HTTP ${apiReachability.status}`}).`,
  );
  await page.evaluate((id) => localStorage.setItem('livio:organization-id', id), organizationId);
  if (!Object.keys(projectSummary.browserAuthTransport).length) {
    const authTransport = await page.evaluate(
      async ({ url, orgId }) => {
        try {
          const response = await fetch(url, {
            headers: {
              Authorization: 'Bearer invalid-synthetic-probe',
              'X-Organization-Id': orgId,
            },
            signal: AbortSignal.timeout(5_000),
          });
          return { status: response.status };
        } catch (error) {
          return { error: error instanceof Error ? error.name : 'fetch failed' };
        }
      },
      { url: `${apiUrl}/v1/auth/me`, orgId: organizationId },
    );
    projectSummary.browserAuthTransport = authTransport;
    assert.equal(
      authTransport.status,
      401,
      `Browser falhou no transporte CORS autenticado ou o guard não rejeitou token inválido (${authTransport.error ?? `HTTP ${authTransport.status}`}).`,
    );
  }
  try {
    await expect(
      page.getByRole('heading', { name: 'Bem-vindo de volta', exact: true }),
    ).toBeVisible({ timeout: moduleTimeoutMs });
    await waitForApiIdle(session, idleTimeoutMs);
  } catch (error) {
    projectSummary.initialPageState = await page.evaluate(() => ({
      readyState: document.readyState,
      loginHeading: [...document.querySelectorAll('h1,h2')].some(
        (heading) => heading.textContent?.trim() === 'Bem-vindo de volta',
      ),
      overviewHeading: [...document.querySelectorAll('h1,h2')].some(
        (heading) => heading.textContent?.trim() === 'Visão geral',
      ),
      loadingIndicator: Boolean(document.querySelector('.loading')),
      navigationVisible: Boolean(document.querySelector('#primary-navigation')),
      scriptCount: document.scripts.length,
      scriptsLoaded: [...document.scripts].filter((script) => script.src).length,
    }));
    throw error;
  }
  const generated = await apiAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: candidate.email,
    options: { redirectTo: `${webUrl}/auth/confirm?next=%2F` },
  });
  assert.ifError(generated.error);
  const tokenHash = generated.data.properties?.hashed_token;
  assert.ok(tokenHash, 'Supabase Auth não retornou hash de uso único para a conta QA.');
  assert.equal(generated.data.user?.id, candidate.authId);
  const confirmUrl = new URL('/auth/confirm', webUrl);
  confirmUrl.searchParams.set('token_hash', tokenHash);
  confirmUrl.searchParams.set('type', 'magiclink');
  confirmUrl.searchParams.set('next', '/');
  await page.goto(confirmUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await waitForApiIdle(session, 10_000);
  return session;
}

function attachRequestObservation(session: BrowserSession) {
  session.page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(apiUrl)) return;
    const row: RouteResult = {
      session: session.index,
      scenario: currentScenario?.name ?? 'login',
      module: session.activeModule,
      method: request.method(),
      route: normalizeApiPath(url),
      startedAt: Date.now(),
    };
    requestRows.push(row);
    session.requestState.set(request, row);
    session.pending.add(request);
    session.lastApiActivityAt = Date.now();
    if (currentScenario) {
      const pendingCount = currentScenario.sessions.reduce(
        (sum, item) => sum + item.pending.size,
        0,
      );
      currentScenario.maxOutstanding = Math.max(currentScenario.maxOutstanding ?? 0, pendingCount);
      if (pendingCount > 24)
        signalScenarioFailure(`Browser manteve ${pendingCount} chamadas API em andamento.`);
    }
  });
  session.page.on('response', (response) => {
    const row = session.requestState.get(response.request());
    if (!row) return;
    row.status = response.status();
    row.serverTiming = parseServerTiming(response.headers()['server-timing']);
    if (
      response.status() === 401 ||
      response.status() === 403 ||
      response.status() === 429 ||
      response.status() >= 500
    )
      signalScenarioFailure(`API respondeu HTTP ${response.status()} em ${row.route}.`);
  });
  session.page.on('requestfinished', (request) => finishRequest(session, request));
  session.page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? '';
    const row = session.requestState.get(request);
    if (!row && request.url().startsWith(webUrl)) {
      const reason = failure.match(/net::ERR_[A-Z0-9_]+/i)?.[0] ?? 'browser request failed';
      session.webFailures.push(`${request.resourceType()}:${reason}`);
    }
    if (row) {
      row.failure = /ABORTED/i.test(failure) ? 'ABORTED' : 'NETWORK_ERROR';
      row.failureReason = failure.match(/net::ERR_[A-Z0-9_]+/i)?.[0] ?? 'browser request failed';
    }
    finishRequest(session, request);
    if (row?.failure === 'NETWORK_ERROR') signalScenarioFailure(`Falha de rede em ${row.route}.`);
  });
}

function finishRequest(session: BrowserSession, request: Request) {
  const row = session.requestState.get(request);
  if (row && row.finishedAt === undefined) {
    row.finishedAt = Date.now();
    row.durationMs = row.finishedAt - row.startedAt;
  }
  session.pending.delete(request);
  session.lastApiActivityAt = Date.now();
}

async function waitForApiIdle(session: BrowserSession, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (currentScenario?.fatalReason) throw new Error(currentScenario.fatalReason);
    if (session.pending.size === 0 && Date.now() - session.lastApiActivityAt >= 350) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Requests API não terminaram em ${timeoutMs} ms; pendentes=${session.pending.size}.`,
  );
}

const modules = [
  { label: 'Clientes', heading: 'Clientes' },
  { label: 'Processos', heading: 'Processos' },
  { label: 'Recebíveis', heading: 'Entradas, parcelas e pagamentos' },
  { label: 'Documentos', heading: 'Documentos' },
  { label: 'Tarefas', heading: 'Tarefas' },
] as const;

async function navigateTo(
  session: BrowserSession,
  label: string,
  heading: string,
  waitIdle: boolean,
) {
  const startedAt = Date.now();
  session.activeModule = label;
  await session.page
    .locator('#primary-navigation')
    .getByRole('button', { name: label, exact: true })
    .click({ timeout: moduleTimeoutMs });
  await expect(session.page.getByRole('heading', { name: heading, exact: true })).toBeVisible({
    timeout: moduleTimeoutMs,
  });
  if (label === 'Recebíveis') {
    await expect(session.page.getByRole('heading', { name: 'Despesas', exact: true })).toBeVisible({
      timeout: moduleTimeoutMs,
    });
  }
  if (waitIdle) await waitForApiIdle(session, idleTimeoutMs);
  else await new Promise((resolve) => setTimeout(resolve, 180));
  return {
    module: label,
    durationMs: Date.now() - startedAt,
    pendingAfterModule: session.pending.size,
  };
}

function routeCounts(rows: RouteResult[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.method !== 'GET') continue;
    const key = row.route;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function scenarioSummary(
  runtime: ScenarioRuntime,
  steps: Array<Record<string, unknown>>,
  cacheCheck?: unknown,
) {
  const endAt = Date.now();
  const relevantRows = requestRows.filter(
    (row) =>
      row.scenario === runtime.name && row.startedAt >= runtime.startAt && row.startedAt <= endAt,
  );
  const startedAt = runtime.startAt;
  const scenarioQueries = apiQueryEvents.filter(
    (event) => event.time >= startedAt && event.time <= endAt,
  );
  const scenarioPool = poolSamples.filter(
    (sample) => sample.time >= startedAt && sample.time <= endAt,
  );
  const durationValues = relevantRows.flatMap((row) =>
    row.durationMs === undefined ? [] : [row.durationMs],
  );
  const statusCounts = Object.fromEntries(
    [
      ...new Set(
        relevantRows
          .map((row) => row.status)
          .filter((status): status is number => status !== undefined),
      ),
    ]
      .sort((a, b) => a - b)
      .map((status) => [
        String(status),
        relevantRows.filter((row) => row.status === status).length,
      ]),
  );
  const routeGroups = new Map<string, RouteResult[]>();
  for (const row of relevantRows) {
    const key = `${row.method} ${row.route}`;
    const values = routeGroups.get(key) ?? [];
    values.push(row);
    routeGroups.set(key, values);
  }
  const serverTimingGroups = new Map<string, number[]>();
  for (const row of relevantRows) {
    for (const [name, value] of Object.entries(row.serverTiming ?? {})) {
      const samples = serverTimingGroups.get(name) ?? [];
      samples.push(value);
      serverTimingGroups.set(name, samples);
    }
  }
  return {
    name: runtime.name,
    status: runtime.fatalReason ? 'FAIL' : 'PASS',
    fatalReason: runtime.fatalReason,
    durationMs: endAt - startedAt,
    sessionCount: runtime.sessions.length,
    requestCount: relevantRows.length,
    requestDurationMs: stats(durationValues),
    httpStatusCounts: statusCounts,
    pendingRequestsAtEnd: runtime.sessions.reduce((sum, session) => sum + session.pending.size, 0),
    maxOutstandingBrowserRequests: runtime.maxOutstanding ?? 0,
    abortedRequests: relevantRows.filter((row) => row.failure === 'ABORTED').length,
    networkFailures: relevantRows.filter((row) => row.failure === 'NETWORK_ERROR').length,
    p2024Count: p2024Times.filter((time) => time >= startedAt && time <= endAt).length,
    maxPoolWaiting: Math.max(0, ...scenarioPool.map((sample) => sample.waiting)),
    maxPoolBusy: Math.max(0, ...scenarioPool.map((sample) => sample.busy)),
    maxPoolOpen: Math.max(0, ...scenarioPool.map((sample) => sample.open)),
    poolWaitHistogramDeltaMs:
      scenarioPool.length > 1
        ? Math.max(0, scenarioPool.at(-1)!.waitSumMs - scenarioPool[0]!.waitSumMs)
        : null,
    prismaQueryEvents: scenarioQueries.length,
    prismaQueryDurationMs: stats(scenarioQueries.map((event) => event.durationMs)),
    serverTimingMs: Object.fromEntries(
      [...serverTimingGroups.entries()].map(([name, samples]) => [name, stats(samples)]),
    ),
    requestsByRoute: Object.fromEntries(
      [...routeGroups.entries()].map(([key, rows]) => [
        key,
        {
          count: rows.length,
          statuses: Object.fromEntries(
            [
              ...new Set(
                rows
                  .map((row) => row.status)
                  .filter((status): status is number => status !== undefined),
              ),
            ]
              .sort((a, b) => a - b)
              .map((status) => [
                String(status),
                rows.filter((row) => row.status === status).length,
              ]),
          ),
          durationMs: stats(
            rows.flatMap((row) => (row.durationMs === undefined ? [] : [row.durationMs])),
          ),
        },
      ]),
    ),
    steps,
    cacheCheck,
  };
}

async function runScenario(name: string, sessions: BrowserSession[]) {
  const runtime: ScenarioRuntime = { name, startAt: Date.now(), sessions };
  currentScenario = runtime;
  const steps: Array<Record<string, unknown>> = [];
  let cacheCheck: Record<string, unknown> | undefined;
  const timeout = setTimeout(
    () => signalScenarioFailure(`Cenário excedeu ${scenarioTimeoutMs} ms.`),
    scenarioTimeoutMs,
  );
  try {
    await Promise.all(
      sessions.map(async (session) => {
        if (session.activeModule !== 'Visão geral') {
          steps.push(await navigateTo(session, 'Visão geral', 'Visão geral', false));
          session.activeModule = 'Visão geral';
        }
        if (sessions.length === 1) {
          const firstClientStart = requestRows.length;
          steps.push(await navigateTo(session, 'Clientes', 'Clientes', true));
          const firstClientGetRoutes = routeCounts(
            requestRows.slice(firstClientStart).filter((row) => row.session === session.index),
          );

          steps.push(await navigateTo(session, 'Visão geral', 'Visão geral', true));
          const repeatClientStart = requestRows.length;
          steps.push(await navigateTo(session, 'Clientes', 'Clientes', true));
          const repeatClientGetRoutes = routeCounts(
            requestRows.slice(repeatClientStart).filter((row) => row.session === session.index),
          );
          const moduleTelemetryPosts = requestRows
            .slice(firstClientStart)
            .filter(
              (row) =>
                row.session === session.index &&
                row.method === 'POST' &&
                row.route === '/v1/audit-logs/module-views' &&
                row.status !== undefined,
            ).length;
          const repeatedGetRoutes = Object.keys(firstClientGetRoutes).filter(
            (route) => (repeatClientGetRoutes[route] ?? 0) > 0,
          );
          if (!Object.keys(firstClientGetRoutes).length)
            signalScenarioFailure('A tela de clientes não produziu uma leitura GET observável.');
          if (!moduleTelemetryPosts)
            signalScenarioFailure(
              'POST de telemetria module-views não foi observado na navegação.',
            );

          const clientStart = requestRows.length;
          await session.page.getByRole('button', { name: 'Abrir', exact: true }).first().click();
          await expect(
            session.page.getByRole('button', { name: 'Voltar à lista', exact: true }),
          ).toBeVisible({ timeout: moduleTimeoutMs });
          await waitForApiIdle(session, idleTimeoutMs);
          const clientViewRows = requestRows
            .slice(clientStart)
            .filter((row) => row.session === session.index);
          const clientTelemetryPosts = clientViewRows.filter(
            (row) =>
              row.method === 'POST' &&
              row.route === '/v1/audit-logs/client-views' &&
              row.status !== undefined,
          ).length;
          if (!clientTelemetryPosts)
            signalScenarioFailure(
              'POST de telemetria client-views não foi observado ao abrir a ficha.',
            );

          const returnStart = requestRows.length;
          await session.page.getByRole('button', { name: 'Voltar à lista', exact: true }).click();
          await expect(
            session.page.getByRole('heading', { name: 'Clientes', exact: true }),
          ).toBeVisible({
            timeout: moduleTimeoutMs,
          });
          await waitForApiIdle(session, idleTimeoutMs);
          const clientReturnRows = requestRows
            .slice(returnStart)
            .filter((row) => row.session === session.index);
          const clientListRefetchesAfterTelemetry = clientReturnRows.filter(
            (row) => row.method === 'GET' && row.route === '/v1/clients',
          ).length;
          if (clientListRefetchesAfterTelemetry)
            signalScenarioFailure('POST client-views invalidou o cache GET da lista de clientes.');
          cacheCheck = {
            firstClientGetRoutes,
            repeatClientGetRoutes,
            repeatedGetRoutes,
            moduleTelemetryPosts,
            clientTelemetryPosts,
            clientListRefetchesAfterTelemetry,
            telemetryDidNotCauseClientRefetch:
              Object.keys(firstClientGetRoutes).length > 0 &&
              moduleTelemetryPosts > 0 &&
              clientTelemetryPosts > 0 &&
              repeatedGetRoutes.length === 0 &&
              clientListRefetchesAfterTelemetry === 0,
          };
          if (repeatedGetRoutes.length > 0)
            signalScenarioFailure(
              `Telemetria causou novas leituras de clientes: ${repeatedGetRoutes.join(', ')}.`,
            );

          for (const module of modules) {
            if (runtime.fatalReason) throw new Error(runtime.fatalReason);
            steps.push(await navigateTo(session, module.label, module.heading, true));
          }
        } else {
          for (const module of modules) {
            if (runtime.fatalReason) throw new Error(runtime.fatalReason);
            steps.push(await navigateTo(session, module.label, module.heading, false));
          }
        }
        await waitForApiIdle(session, idleTimeoutMs);
      }),
    );
  } catch (error) {
    if (!runtime.fatalReason) runtime.fatalReason = safeError(error);
    for (const session of sessions) await session.page.close().catch(() => undefined);
  } finally {
    clearTimeout(timeout);
    currentScenario = undefined;
  }
  return scenarioSummary(runtime, steps, sessions.length === 1 ? cacheCheck : undefined);
}

function readApiLogSummary() {
  const text = existsSync(apiLogPath) ? readFileSync(apiLogPath, 'utf8') : '';
  const lines = text.split(/\r?\n/).filter(Boolean);
  const p2024Count = lines.filter((line) => /\bP2024\b/.test(line)).length;
  const httpRows: Array<{
    time?: number;
    method?: string;
    status?: number;
    responseTime?: number;
  }> = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as {
        time?: number;
        req?: { method?: string };
        res?: { statusCode?: number };
        responseTime?: number;
      };
      if (typeof value.responseTime === 'number')
        httpRows.push({
          time: value.time,
          method: value.req?.method,
          status: value.res?.statusCode,
          responseTime: value.responseTime,
        });
    } catch {
      // Non-JSON framework lines do not contain metrics.
    }
  }
  const querySignatures = new Map<
    string,
    { operation: string; tables: string[]; durations: number[] }
  >();
  for (const event of apiQueryEvents) {
    const key = `${event.operation}:${event.signature}`;
    const entry = querySignatures.get(key) ?? {
      operation: event.operation,
      tables: event.tables,
      durations: [],
    };
    entry.durations.push(event.durationMs);
    querySignatures.set(key, entry);
  }
  return {
    p2024Count,
    apiResponseCount: httpRows.length,
    apiResponseMs: stats(
      httpRows.flatMap((row) => (row.responseTime === undefined ? [] : [row.responseTime])),
    ),
    prismaQueryCount: apiQueryEvents.length,
    prismaQueryShapes: [...querySignatures.entries()].map(([signature, shape]) => ({
      signature,
      operation: shape.operation,
      tables: shape.tables,
      count: shape.durations.length,
      durationMs: stats(shape.durations),
    })),
    poolSamples: poolSamples.length,
    maxPoolWaiting: Math.max(0, ...poolSamples.map((sample) => sample.waiting)),
    maxPoolBusy: Math.max(0, ...poolSamples.map((sample) => sample.busy)),
    maxPoolOpen: Math.max(0, ...poolSamples.map((sample) => sample.open)),
  };
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  const startedAt = new Date().toISOString();
  let candidate: Candidate | undefined;
  let prismaAfter: PrismaClient | undefined;
  const result: Record<string, unknown> = {
    runId,
    startedAt,
    status: 'BLOCKED',
    scope:
      'navigation real somente leitura de negócio; autenticação sintética, rate limit e telemetry geram registros técnicos',
    preflight: {
      sharedProjectConnectedToProduction: true,
      authSignupDisabled: true,
      externalCredentialsPresentInApiProcess: false,
      pushSubscribersInQaOrganization: 0,
      oneApiProcess: true,
      newOrganizationCreated: false,
      newBusinessRecordsCreated: false,
      identityLogin:
        'existing active synthetic administrator via one-time Supabase Auth link generated server-side; no email sent',
    },
    project: projectSummary,
    scenarios: [],
    artifacts: { apiLog: apiLogPath, webLog: webLogPath },
  };

  const sessions: BrowserSession[] = [];
  try {
    candidate = await preflight();
    const apiPort = await allocatePort();
    const webPort = await allocatePort();
    apiUrl = `http://127.0.0.1:${apiPort}`;
    webUrl = `http://localhost:${webPort}`;

    apiProcess = startApi(apiPort, webUrl);
    await waitForProcessReady(apiProcess, `${apiUrl}/v1/health/ready`, 30_000);
    webProcess = startWeb(webPort, apiUrl);
    await waitForProcessReady(webProcess, webUrl, 45_000);
    browser = await chromium.launch({
      headless: true,
      timeout: 15_000,
      ...(process.env.PLAYWRIGHT_CHROME_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
        : {}),
    });

    const sessionSets = [1, 2, 3];
    for (const count of sessionSets) {
      const scenarioSessions: BrowserSession[] = [];
      for (let index = 0; index < count; index += 1) {
        const session = await createAuthenticatedSession(
          sessions.length + 1,
          candidate,
          candidate.organizationId,
          browser,
        );
        sessions.push(session);
        scenarioSessions.push(session);
      }
      const scenarioName = `${count}_sess${count === 1 ? 'ao' : 'oes'}`;
      const summary = await runScenario(scenarioName, scenarioSessions);
      (result.scenarios as unknown[]).push(summary);
      for (const session of scenarioSessions) await session.context.close().catch(() => undefined);
      if (summary.status !== 'PASS') break;
      if (
        count === 1 &&
        (summary.maxPoolWaiting > 1 ||
          summary.pendingRequestsAtEnd > 0 ||
          summary.maxOutstandingBrowserRequests > 8 ||
          (summary.requestDurationMs.p95Ms ?? Number.POSITIVE_INFINITY) > 8_000)
      ) {
        (result.scenarios as unknown[]).push({
          name: '2_sessoes',
          status: 'NOT_RUN',
          reason:
            'Concorrência com duas sessões não iniciada: o cenário solo apresentou fila ou latência sem margem suficiente.',
        });
        break;
      }
      if (
        count === 2 &&
        (summary.maxPoolWaiting > 1 ||
          summary.pendingRequestsAtEnd > 0 ||
          summary.maxOutstandingBrowserRequests > 12 ||
          (summary.requestDurationMs.p95Ms ?? Number.POSITIVE_INFINITY) > 8_000)
      ) {
        (result.scenarios as unknown[]).push({
          name: '3_sessoes',
          status: 'NOT_RUN',
          reason:
            'Concorrência limitada a três não iniciada: o cenário com duas sessões não manteve margem suficiente.',
        });
        break;
      }
    }
    const scenarioStatuses = (result.scenarios as Array<{ status: string }>).map(
      (scenario) => scenario.status,
    );
    result.status = scenarioStatuses.every((status) => status === 'PASS')
      ? 'PASS'
      : scenarioStatuses.includes('FAIL')
        ? 'FAIL'
        : 'PARTIAL';
  } catch (error) {
    result.status = 'BLOCKED';
    result.blocker = safeError(error);
  } finally {
    for (const session of sessions) await session.context.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await stopProcess(webProcess);
    await stopProcess(apiProcess);
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    apiLogPending = apiLogPending ? `${apiLogPending}\n` : '';
    if (apiLogPending) {
      parseApiLogLine(apiLogPending);
      apiLog?.write(`${apiLogPending}\n`);
    }
    webLogPending = webLogPending ? `${webLogPending}\n` : '';
    if (webLogPending) {
      const safe = webLogPending.replace(
        /(token_hash|access_token|refresh_token|otp)=([^&\s]+)/gi,
        '$1=[REDACTED]',
      );
      webLog?.write(`${safe}\n`);
    }
    await Promise.all(
      [apiLog, webLog]
        .filter(Boolean)
        .map((stream) => new Promise<void>((resolve) => stream!.end(resolve))),
    );
    if (candidate) {
      prismaAfter = new PrismaClient();
      try {
        const afterBusiness = await snapshotQaBusinessCounts(prismaAfter, candidate.organizationId);
        projectSummary.technicalCountsAfter = await snapshotTechnicalCounts(
          prismaAfter,
          candidate.organizationId,
          candidate.userId,
        );
        const [dbAfter] = await prismaAfter.$queryRaw<
          Array<{
            visibleConnections: number;
            activeConnections: number;
          }>
        >`SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS "visibleConnections",
                 (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='active') AS "activeConnections"`;
        projectSummary.databaseLimits.visibleConnectionsAfter = dbAfter?.visibleConnections ?? -1;
        projectSummary.databaseLimits.activeConnectionsAfter = dbAfter?.activeConnections ?? -1;
        result.preexistingBusinessDataPreserved =
          JSON.stringify(projectSummary.businessTables) === JSON.stringify(afterBusiness);
        result.businessTablesAfter = afterBusiness;
      } catch (error) {
        result.postflightError = safeError(error);
      } finally {
        await prismaAfter.$disconnect();
      }
    }
    result.apiDiagnostics = readApiLogSummary();
    result.finishedAt = new Date().toISOString();
    result.httpRequests = requestRows.map(
      ({
        session,
        scenario,
        module,
        method,
        route,
        durationMs,
        status,
        serverTiming,
        failure,
        failureReason,
      }) => ({
        session,
        scenario,
        module,
        method,
        route,
        durationMs,
        status,
        serverTiming,
        failure,
        failureReason,
      }),
    );
    result.pageErrorCount = sessions.reduce((sum, session) => sum + session.pageErrors, 0);
    result.browserConsoleDiagnostics = [
      ...new Set(sessions.flatMap((session) => session.consoleErrors)),
    ];
    result.webResourceFailures = [...new Set(sessions.flatMap((session) => session.webFailures))];
    const loginRows = requestRows.filter((row) => row.scenario === 'login');
    result.loginDiagnostics = {
      localApiRequests: loginRows.length,
      durationMs: stats(
        loginRows.flatMap((row) => (row.durationMs === undefined ? [] : [row.durationMs])),
      ),
      routes: Object.fromEntries(
        [...new Set(loginRows.map((row) => row.route))].map((route) => [
          route,
          {
            count: loginRows.filter((row) => row.route === route).length,
            statuses: Object.fromEntries(
              [
                ...new Set(
                  loginRows
                    .filter((row) => row.route === route)
                    .map((row) => row.status)
                    .filter(Number.isFinite),
                ),
              ].map((status) => [
                String(status),
                loginRows.filter((row) => row.route === route && row.status === status).length,
              ]),
            ),
          },
        ]),
      ),
    };
    writeFileSync(outputPath, JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(
      JSON.stringify(
        {
          status: result.status,
          artifact: outputPath,
          scenarios: result.scenarios,
          apiDiagnostics: result.apiDiagnostics,
        },
        null,
        2,
      ),
    );
    if (result.status !== 'PASS') process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`QA navigation encerrou: ${safeError(error)}\n`);
  process.exitCode = 1;
});
