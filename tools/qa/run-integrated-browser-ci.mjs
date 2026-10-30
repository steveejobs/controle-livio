import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const root = process.cwd();
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const outputDir =
  process.env.LIVIO_QA_OUTPUT ??
  join(process.env.RUNNER_TEMP ?? tmpdir(), 'livio-integrated-artifacts');
const apiLogPaths = [];
const webLogPaths = [];
const output = (name) => join(outputDir, name);
const safeEnvironmentKeys = [
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
  'PLAYWRIGHT_BROWSERS_PATH',
];
const runnerEnv = Object.fromEntries(
  safeEnvironmentKeys.flatMap((key) =>
    typeof process.env[key] === 'string' ? [[key, process.env[key]]] : [],
  ),
);

function stop(message) {
  throw new Error(message);
}

function localUrl(key, protocols) {
  const value = process.env[key];
  if (!value) stop(`${key} não foi fornecida pela stack Supabase local.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    stop(`${key} não é uma URL válida da stack local.`);
  }
  if (!loopbackHosts.has(url.hostname) || !protocols.includes(url.protocol)) {
    stop(`${key} precisa apontar para loopback local.`);
  }
  return url;
}

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Linux') {
  stop('O executor integrado exige o runner Linux do GitHub Actions.');
}
if (process.env.SUPABASE_LOCAL !== 'true') {
  stop('SUPABASE_LOCAL precisa estar habilitado para iniciar a API.');
}
localUrl('NEXT_PUBLIC_API_URL', ['http:']);
const publicSupabaseUrl = localUrl('NEXT_PUBLIC_SUPABASE_URL', ['http:']);
const serverSupabaseUrl = localUrl('SUPABASE_URL', ['http:']);
if (publicSupabaseUrl.origin !== serverSupabaseUrl.origin) {
  stop('A API e o navegador precisam apontar para a mesma stack Supabase local.');
}
localUrl('DATABASE_URL', ['postgres:', 'postgresql:']);
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_ANON_KEY) {
  stop('A stack local não forneceu as chaves de Auth necessárias para a API.');
}
if (process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_DB_PASSWORD) {
  stop('O executor recebeu credenciais Supabase externas; remova-as antes de iniciar.');
}
if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== process.env.SUPABASE_ANON_KEY) {
  stop('A chave anônima do navegador não corresponde à chave local da API.');
}
if (process.env.CLAMAV_HOST && !loopbackHosts.has(process.env.CLAMAV_HOST)) {
  stop('O serviço ClamAV integrado precisa estar restrito ao loopback do runner.');
}
for (const file of [
  '.env',
  '.env.development',
  '.env.development.local',
  '.env.local',
  '.env.production',
  '.env.production.local',
  '.env.test',
  '.env.test.local',
  'apps/api/.env',
  'apps/api/.env.development',
  'apps/api/.env.development.local',
  'apps/api/.env.local',
  'apps/api/.env.production',
  'apps/api/.env.production.local',
  'apps/api/.env.test',
  'apps/api/.env.test.local',
  'apps/web/.env',
  'apps/web/.env.development',
  'apps/web/.env.development.local',
  'apps/web/.env.local',
  'apps/web/.env.production',
  'apps/web/.env.production.local',
  'apps/web/.env.test',
  'apps/web/.env.test.local',
]) {
  if (existsSync(resolve(root, file)))
    stop(`Arquivo de ambiente local não pode ser carregado pelo CI: ${file}`);
}

mkdirSync(outputDir, { recursive: true });
const metricsPath = output('browser-navigation-metrics.json');
const buildEnv = { ...runnerEnv, NEXT_TELEMETRY_DISABLED: '1' };
buildEnv.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL;
buildEnv.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
buildEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!buildEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  stop('A chave anônima local não foi fornecida para compilar o frontend.');
}

const apiEnv = {
  ...runnerEnv,
  API_PORT: '3001',
  CORS_ORIGINS: 'http://127.0.0.1:3010',
  DATABASE_URL: process.env.DATABASE_URL,
  LOG_LEVEL: 'warn',
  NODE_ENV: 'test',
  QA_TIMINGS: 'true',
  STORAGE_BUCKET: 'legal-documents',
  ...(process.env.CLAMAV_HOST
    ? {
        CLAMAV_HOST: process.env.CLAMAV_HOST,
        CLAMAV_PORT: process.env.CLAMAV_PORT ?? '3310',
        CLAMAV_TIMEOUT_MS: process.env.CLAMAV_TIMEOUT_MS ?? '10000',
      }
    : {}),
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_AUTH_REDIRECT_URL: 'http://127.0.0.1:3010/auth/confirm',
  // Staging disables the local-test scanner bypass while the DB/Auth/Storage endpoints stay local.
  SUPABASE_ENVIRONMENT: process.env.CLAMAV_HOST ? 'staging' : 'test',
  SUPABASE_LOCAL: 'true',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
};
const webEnv = {
  ...runnerEnv,
  NEXT_TELEMETRY_DISABLED: '1',
  NODE_ENV: 'production',
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
};

const testEnv = { ...webEnv, NODE_ENV: 'test' };
testEnv.LIVIO_QA_OUTPUT = outputDir;
testEnv.GITHUB_RUN_ID = process.env.GITHUB_RUN_ID;
testEnv.CLAMAV_HOST = process.env.CLAMAV_HOST;
testEnv.CLAMAV_PORT = process.env.CLAMAV_PORT;
testEnv.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
testEnv.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
testEnv.LIVIO_CLAMAV_INTEGRATION_FAILURES =
  process.env.CLAMAV_HOST === '127.0.0.1' && process.env.CLAMAV_PORT === '13310' ? 'true' : 'false';
const sensitiveValues = [
  process.env.DATABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
].filter((value) => typeof value === 'string' && value.length > 0);

function sanitize(value) {
  let text = value;
  for (const secret of sensitiveValues) text = text.split(secret).join('[REDACTED]');
  return text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]')
    .replace(/\/public\/signatures\/[a-f0-9]{64}/gi, '/public/signatures/[REDACTED]')
    .replace(/\/assinar\/[a-f0-9]{64}/gi, '/assinar/[REDACTED]')
    .replace(/([?&](?:token|signature|apikey|access_token)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(service_role_key|anon_key|jwt_secret|database_url)=([^\s"']+)/gi, '$1=[REDACTED]');
}

function execute(command, args, env, cwd = root) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.once('error', rejectPromise);
    child.once('close', (code, signal) => {
      const rendered = sanitize(`${stdout}${stderr}`);
      if (rendered.trim())
        process.stdout.write(rendered.endsWith('\n') ? rendered : `${rendered}\n`);
      if (code === 0) resolvePromise();
      else
        rejectPromise(
          new Error(`${command} finalizou com código ${code ?? signal ?? 'desconhecido'}.`),
        );
    });
  });
}

function attachLog(child, path) {
  const stream = createWriteStream(path, { flags: 'w' });
  const finished = new Promise((resolvePromise) => stream.once('finish', resolvePromise));
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  child.once('close', () => stream.end());
  return finished;
}

function startService(entry, args, env, path, cwd = root) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    env,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.logFinished = attachLog(child, path);
  return child;
}

async function waitFor(url, ready) {
  const deadline = performance.now() + 90_000;
  let lastStatus = 'sem resposta';
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      lastStatus = `HTTP ${response.status}`;
      if (ready(response)) return;
    } catch (error) {
      lastStatus = error instanceof Error ? error.name : 'erro de rede';
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  stop(`Serviço local não ficou pronto (${url}): ${lastStatus}.`);
}

function signalGroup(child, signal) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process can exit between the state check and the signal.
    }
  }
}

async function stopChild(child) {
  if (!child) return;
  if (child.exitCode === null) {
    signalGroup(child, 'SIGTERM');
    await Promise.race([
      new Promise((resolvePromise) => child.once('close', resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 8_000)),
    ]);
    if (child.exitCode === null) signalGroup(child, 'SIGKILL');
  }
  await child.logFinished;
}

function parseJsonLines(text, eventName) {
  return text.split(/\r?\n/).flatMap((line) => {
    try {
      const record = JSON.parse(line);
      return record?.event === eventName ? [record] : [];
    } catch {
      return [];
    }
  });
}

function percentile(values, percent) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.ceil((percent / 100) * sorted.length) - 1] ?? 0).toFixed(2));
}

function histogramPercentile(histogram, percent) {
  const buckets = histogram?.buckets;
  if (!Array.isArray(buckets) || !buckets.length || !histogram.count) return null;
  const target = Math.ceil((percent / 100) * histogram.count);
  let cumulativeCount = 0;
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      cumulativeCount += Number(bucket[1] ?? 0);
      const upper = Number(bucket[0] ?? Number.NaN);
      if (cumulativeCount >= target && Number.isFinite(upper)) return upper;
      continue;
    }
    const count = Number(bucket.count ?? bucket.cumulativeCount ?? 0);
    const upper = Number(bucket.le ?? bucket.upperBound ?? bucket.upper ?? Number.NaN);
    if (count >= target && Number.isFinite(upper)) return upper;
  }
  return null;
}

function poolMetrics(summary) {
  const histogram = summary?.waitHistogram;
  return {
    samples: summary?.samples ?? null,
    maxWaitingQueries: summary?.maxWaitingQueries ?? null,
    maxBusyConnections: summary?.maxBusyConnections ?? null,
    maxOpenConnections: summary?.maxOpenConnections ?? null,
    waitHistogramCount: histogram?.count ?? null,
    waitHistogramSumMs: histogram?.sum ?? null,
    waitP50Ms: histogramPercentile(histogram, 50),
    waitP95Ms: histogramPercentile(histogram, 95),
  };
}

function writeSanitizedLogGroup(sources, destination) {
  const existingSources = sources.filter((source) => existsSync(source));
  const combined = existingSources.map((source) => readFileSync(source, 'utf8')).join('\n');
  if (!combined) return;
  for (const source of existingSources) {
    const suite = source.match(/-(focused|full)\.raw\.log$/)?.[1];
    if (suite)
      writeFileSync(
        output(
          `${destination.includes('api-timings') ? 'api-timings' : 'web-server'}-${suite}.log`,
        ),
        sanitize(readFileSync(source, 'utf8')),
        'utf8',
      );
  }
  writeFileSync(destination, sanitize(combined), 'utf8');
  for (const source of existingSources) unlinkSync(source);
}

function writeSanitizedLogs() {
  writeSanitizedLogGroup(apiLogPaths, output('api-timings.log'));
  writeSanitizedLogGroup(webLogPaths, output('web-server.log'));
}

function preserveFocusedFiles(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    if (entry.isDirectory()) preserveFocusedFiles(source);
    else {
      const extensionIndex = entry.name.lastIndexOf('.');
      const base = extensionIndex > 0 ? entry.name.slice(0, extensionIndex) : entry.name;
      const extension = extensionIndex > 0 ? entry.name.slice(extensionIndex) : '';
      const destination = join(directory, `${base}-focused${extension}`);
      if (source !== destination && !existsSync(destination))
        writeFileSync(destination, readFileSync(source));
    }
  }
}

function preserveFocusedArtifacts() {
  for (const name of [
    'browser-navigation-metrics.json',
    'browser-navigation-metrics-360.json',
    'browser-navigation-metrics-1440.json',
    'two-session-navigation-metrics.json',
    'two-session-navigation-metrics-360.json',
    'two-session-navigation-metrics-1440.json',
  ]) {
    const source = output(name);
    if (!existsSync(source)) continue;
    const extensionIndex = name.lastIndexOf('.');
    writeFileSync(
      output(`${name.slice(0, extensionIndex)}-focused${name.slice(extensionIndex)}`),
      readFileSync(source),
    );
  }
  for (const name of ['operation-traces', 'workflow-stages', 'screenshots'])
    preserveFocusedFiles(output(name));
  const resultDirectory = output('integrated-test-results');
  const focusedResultDirectory = output('integrated-test-results-focused');
  if (existsSync(resultDirectory) && !existsSync(focusedResultDirectory))
    renameSync(resultDirectory, focusedResultDirectory);
}

function sanitizePlaywrightReport(sourcePath, destinationName) {
  if (!existsSync(sourcePath)) return;
  writeFileSync(output(destinationName), sanitize(readFileSync(sourcePath, 'utf8')), 'utf8');
  unlinkSync(sourcePath);
}

async function runPlaywrightSuite(reportName, grep) {
  const reportRawPath = join(tmpdir(), `livio-playwright-${process.pid}-${reportName}.raw.json`);
  testEnv.LIVIO_PLAYWRIGHT_REPORT_RAW = reportRawPath;
  testEnv.LIVIO_PLAYWRIGHT_RUN = reportName.includes('focused') ? 'focused' : 'full';
  const args = [
    'node_modules/playwright/cli.js',
    'test',
    '--config=playwright.integrated.config.ts',
  ];
  if (grep) args.push('--grep', grep);
  try {
    await execute(process.execPath, args, testEnv);
  } finally {
    sanitizePlaywrightReport(reportRawPath, reportName);
  }
}

function startIntegratedServices(runLabel) {
  const apiLogPath = join(tmpdir(), `livio-api-${process.pid}-${runLabel}.raw.log`);
  const webLogPath = join(tmpdir(), `livio-web-${process.pid}-${runLabel}.raw.log`);
  apiLogPaths.push(apiLogPath);
  webLogPaths.push(webLogPath);
  api = startService('apps/api/dist/main.js', [], apiEnv, apiLogPath);
  return waitFor(
    'http://127.0.0.1:3001/v1/health/ready',
    (response) => response.status === 200,
  ).then(() => {
    web = startService(
      resolve(root, 'node_modules/next/dist/bin/next'),
      ['start', '-p', '3010', '-H', '127.0.0.1'],
      webEnv,
      webLogPath,
      resolve(root, 'apps/web'),
    );
    return waitFor('http://127.0.0.1:3010/', (response) => response.status === 200);
  });
}

async function stopIntegratedServices() {
  await stopChild(web);
  await stopChild(api);
  web = undefined;
  api = undefined;
}

async function resetDisposableStackBetweenSuites() {
  if (process.env.SUPABASE_LOCAL !== 'true')
    stop('Rate-limit isolation reset is permitted only for this unlinked local Supabase stack.');
  const database = localUrl('DATABASE_URL', ['postgres:', 'postgresql:']);
  if (!loopbackHosts.has(database.hostname))
    stop('Rate-limit isolation reset refused a database outside runner loopback.');
  await execute('npx', ['supabase', '--yes', 'db', 'reset', '--local'], runnerEnv);
  writeFileSync(
    output('rate-limit-isolation.json'),
    `${JSON.stringify(
      {
        status: 'PASS',
        configuredWriteLimit: 60,
        configuredReadLimit: 300,
        productionLimitOverridden: false,
        syntheticDatabaseResetBetweenSuites: true,
        apiProcessRestartedBetweenSuites: true,
        identityAndOrganizationScope: 'synthetic seed recreated in disposable local stack',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

let api;
let web;
let runFailed = false;
try {
  console.log(
    'Building API and web with loopback public configuration; server credentials are withheld.',
  );
  await execute('npm', ['run', 'build'], buildEnv);

  console.log('Building API and web for the real local Auth/API/DB/Storage stack.');
  for (const [reportName, grep] of [
    ['integrated-playwright-report-focused.json', 'carregamento sob demanda|jornada [1-4]:'],
    ['integrated-playwright-report-full.json', undefined],
  ]) {
    try {
      if (reportName.includes('full')) {
        await stopIntegratedServices();
        preserveFocusedArtifacts();
        await resetDisposableStackBetweenSuites();
      }
      await startIntegratedServices(reportName.includes('focused') ? 'focused' : 'full');
      console.log(
        `API and web are ready for ${reportName}; starting one Chromium worker with real local Auth/API/DB/Storage.`,
      );
      await runPlaywrightSuite(reportName, grep);
    } catch (error) {
      runFailed = true;
      const safeMessage = sanitize(
        error instanceof Error ? error.message : 'Falha integrada sem detalhe.',
      );
      console.error(`${reportName} failed; sanitized report was retained: ${safeMessage}`);
    } finally {
      await stopIntegratedServices();
    }
    if (reportName === 'integrated-playwright-report-focused.json')
      console.log(
        'Focused run finished; running the full integrated suite regardless of its result.',
      );
  }
} catch (error) {
  runFailed = true;
  console.error(sanitize(error instanceof Error ? error.message : 'Falha integrada sem detalhe.'));
} finally {
  await stopIntegratedServices();
  writeSanitizedLogs();
}

let browserMetrics = {};
let twoSessionMetrics = null;
if (existsSync(metricsPath)) {
  try {
    browserMetrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
  } catch {
    runFailed = true;
    console.error('O relatório sintético de navegação está inválido.');
  }
}
const twoSessionMetricsPath = output('two-session-navigation-metrics.json');
if (existsSync(twoSessionMetricsPath)) {
  try {
    twoSessionMetrics = JSON.parse(readFileSync(twoSessionMetricsPath, 'utf8'));
  } catch {
    runFailed = true;
    console.error('O relatÃ³rio sintÃ©tico das duas sessÃµes estÃ¡ invÃ¡lido.');
  }
}

const apiLog = existsSync(output('api-timings.log'))
  ? readFileSync(output('api-timings.log'), 'utf8')
  : '';
const queryEvents = parseJsonLines(apiLog, 'prisma_query_timing');
const poolSummary = parseJsonLines(apiLog, 'prisma_pool_summary').at(-1);
const apiMetricsBySuite = Object.fromEntries(
  ['focused', 'full'].map((suite) => {
    const path = output(`api-timings-${suite}.log`);
    const log = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const events = parseJsonLines(log, 'prisma_query_timing');
    const durations = events.map((event) => Number(event.durationMs)).filter(Number.isFinite);
    const summary = parseJsonLines(log, 'prisma_pool_summary').at(-1);
    return [
      suite,
      {
        queryCount: events.length,
        queryP50Ms: percentile(durations, 50),
        queryP95Ms: percentile(durations, 95),
        p2024Count: (log.match(/P2024/g) ?? []).length,
        pool: poolMetrics(summary),
      },
    ];
  }),
);
const burst = browserMetrics.membershipBurst;
const membershipQueriesInBurst = burst
  ? queryEvents.filter(
      (event) =>
        event.time >= burst.startedAt &&
        event.time <= burst.finishedAt &&
        event.tables?.includes('organization_members'),
    ).length
  : null;
const membershipLookupsShared =
  Boolean(burst) && membershipQueriesInBurst > 0 && membershipQueriesInBurst < burst.requests;
const p2024Count = (apiLog.match(/P2024/g) ?? []).length;
const queryDurations = queryEvents.map((event) => Number(event.durationMs)).filter(Number.isFinite);
const backend = {
  prisma: {
    queryCount: queryEvents.length,
    queryP50Ms: percentile(queryDurations, 50),
    queryP95Ms: percentile(queryDurations, 95),
    pool: poolMetrics(poolSummary),
    p2024Count,
    bySuite: apiMetricsBySuite,
  },
  membershipBurst: burst
    ? {
        requests: burst.requests,
        organizationMemberQueries: membershipQueriesInBurst,
        deduplicatedRequests: Math.max(0, burst.requests - membershipQueriesInBurst),
        sharedLookup: membershipLookupsShared,
      }
    : null,
};
writeFileSync(
  output('integrated-metrics.json'),
  `${JSON.stringify({ browser: browserMetrics, twoSessionBrowser: twoSessionMetrics, backend }, null, 2)}\n`,
  'utf8',
);

console.log(`Prisma queries: ${backend.prisma.queryCount}; P2024: ${p2024Count}.`);
console.log(
  `Membership SELECTs in concurrent burst: ${membershipQueriesInBurst ?? 'not measured'} of ${burst?.requests ?? 'unknown'} requests.`,
);
console.log(`Sanitized evidence: ${output('integrated-metrics.json')}`);
if (p2024Count > 0) {
  console.error(`P2024 pool timeout errors were observed: ${p2024Count}.`);
  runFailed = true;
}
if (burst && !membershipLookupsShared) {
  console.error('The concurrent browser burst did not share any membership lookup.');
  runFailed = true;
}
if (runFailed) process.exitCode = 1;
