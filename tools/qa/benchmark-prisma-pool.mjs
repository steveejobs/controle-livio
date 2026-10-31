import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';

const projectRef = 'ioebcdpyrszokdyaoaqv';
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
const supabaseUrl = new URL(process.env.SUPABASE_URL ?? '');
const artifactDir = process.env.QA_ARTIFACT_DIR ?? 'test-results';
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
assert.equal(
  process.env.QA_ALLOW_SHARED_DATABASE_READ_BENCHMARK,
  'true',
  'Defina a autorização temporária para o benchmark de leitura no banco compartilhado.',
);
assert.equal(process.env.QA_PROJECT_REF, projectRef);
assert.equal(process.env.CONFIRM_SUPABASE_PROJECT_REF, projectRef);
assert.equal(
  databaseUrl.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(databaseUrl.username).includes(projectRef),
  true,
  'DATABASE_URL não aponta para o projeto autorizado.',
);
assert.equal(supabaseUrl.hostname, `${projectRef}.supabase.co`);
assert.equal(databaseUrl.port, '6543');
assert.equal(databaseUrl.searchParams.get('pgbouncer'), 'true');

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.ceil(p * sorted.length) - 1]) : null;
}

function metric(metrics, key) {
  return metrics.gauges.find((entry) => entry.key === key)?.value ?? 0;
}

function waitHistogram(metrics) {
  return metrics.histograms.find((entry) => entry.key === 'prisma_client_queries_wait_histogram_ms')
    ?.value;
}

async function oneScenario(limit) {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', String(limit));
  url.searchParams.set('pool_timeout', '10');
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const samples = [];
  const errors = [];
  let maxWaiting = 0;
  let maxBusy = 0;
  let maxOpen = 0;
  let sampling = false;
  const samplePool = async () => {
    if (sampling) return;
    sampling = true;
    try {
      const current = await prisma.$metrics.json();
      maxWaiting = Math.max(maxWaiting, metric(current, 'prisma_client_queries_wait'));
      maxBusy = Math.max(maxBusy, metric(current, 'prisma_pool_connections_busy'));
      maxOpen = Math.max(maxOpen, metric(current, 'prisma_pool_connections_open'));
    } finally {
      sampling = false;
    }
  };
  const sampleTimer = setInterval(() => void samplePool(), 20);
  try {
    const database = await prisma.$queryRaw`
      SELECT current_setting('max_connections')::int AS max_connections,
             current_setting('superuser_reserved_connections')::int AS reserved_connections,
             (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS visible_connections,
             (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND state='active') AS active_connections`;
    const capacity = database[0];
    assert.ok(
      capacity.visible_connections < capacity.max_connections - capacity.reserved_connections - 10,
      `Margem de conexões menor que dez antes do cenário com pool ${limit}.`,
    );
    const before = await prisma.$metrics.json();
    for (let batch = 0; batch < 3; batch += 1) {
      const values = await Promise.all(
        Array.from({ length: 3 }, async () => {
          const started = performance.now();
          try {
            await prisma.$queryRaw`SELECT pg_sleep(0.08) IS NULL AS complete`;
            const durationMs = performance.now() - started;
            samples.push(durationMs);
            return { status: 'PASS', durationMs: Math.round(durationMs) };
          } catch (error) {
            const code =
              typeof error === 'object' && error && 'code' in error ? error.code : 'ERROR';
            errors.push(String(code));
            return { status: 'FAIL', code: String(code) };
          }
        }),
      );
      await samplePool();
      if (values.some((value) => value.status === 'FAIL')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const after = await prisma.$metrics.json();
    const beforeWait = waitHistogram(before);
    const afterWait = waitHistogram(after);
    return {
      connectionLimit: limit,
      poolTimeoutSeconds: 10,
      concurrency: 3,
      batches: 3,
      samples: samples.length,
      latencyMs: {
        p50: percentile(samples, 0.5),
        p95: percentile(samples, 0.95),
        max: samples.length ? Math.round(Math.max(...samples)) : null,
      },
      errors,
      maxPoolMetrics: { waiters: maxWaiting, busyConnections: maxBusy, openConnections: maxOpen },
      waitHistogramDelta: {
        count: Math.max(0, (afterWait?.count ?? 0) - (beforeWait?.count ?? 0)),
        sumMs: Number(Math.max(0, (afterWait?.sum ?? 0) - (beforeWait?.sum ?? 0)).toFixed(3)),
        buckets: (afterWait?.buckets ?? []).map(([upperMs, count], index) => [
          upperMs,
          Math.max(0, count - (beforeWait?.buckets[index]?.[1] ?? 0)),
        ]),
      },
      databaseCapacity: capacity,
      readOnly: true,
    };
  } finally {
    clearInterval(sampleTimer);
    await prisma.$disconnect();
  }
}

const scenarios = [];
let interrupted = false;
for (const limit of [1, 2, 3]) {
  const result = await oneScenario(limit);
  scenarios.push(result);
  if (result.errors.length) {
    interrupted = true;
    break;
  }
}

const output = {
  runId,
  projectRef,
  databaseHost: databaseUrl.hostname,
  databasePort: databaseUrl.port,
  pooler: 'Supabase transaction mode',
  workload: '3 concorrentes × 3 lotes de SELECT pg_sleep(80 ms), sem acesso a tabelas de negócio',
  status: interrupted ? 'FAIL' : scenarios.length === 3 ? 'PASS' : 'PARTIAL',
  scenarios,
  interrupted,
};
mkdirSync(artifactDir, { recursive: true });
const outputPath = join(artifactDir, `qa-prisma-pool-${runId}.json`);
writeFileSync(outputPath, JSON.stringify(output, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ ...output, artifact: outputPath }, null, 2));
if (interrupted) process.exitCode = 1;
