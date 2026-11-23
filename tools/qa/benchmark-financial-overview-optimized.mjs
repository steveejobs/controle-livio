import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@livio/db');
const { ClientsService } = require('../../apps/api/dist/clients/clients.service.js');

const runPrefix = process.env.QA_RUN_PREFIX;
const outputPath = process.env.QA_BENCHMARK_OUTPUT;
const warmSamples = Number(process.env.QA_OVERVIEW_WARM_SAMPLES ?? 10);
if (!runPrefix || !outputPath) throw new Error('Informe prefixo sintético QA e arquivo de saída.');
if (!/^qa-workflows-[0-9]+-[a-f0-9]+-$/.test(runPrefix)) {
  throw new Error('O prefixo precisa identificar uma organização sintética de uma execução QA.');
}
if (!Number.isInteger(warmSamples) || warmSamples < 3 || warmSamples > 12) {
  throw new Error('Amostras aquecidas devem estar entre 3 e 12.');
}

const databaseUrl = new URL(process.env.DATABASE_URL);
const supabaseUrl = new URL(process.env.SUPABASE_URL);
const declaredRef = process.env.SUPABASE_PROJECT_REF;
const supabaseRef = supabaseUrl.hostname.split('.')[0];
const databaseUser = decodeURIComponent(databaseUrl.username);
const databaseRef = databaseUser.startsWith('postgres.')
  ? databaseUser.slice('postgres.'.length)
  : '';
if (!declaredRef || declaredRef !== supabaseRef || databaseRef !== supabaseRef) {
  throw new Error('Ref do Supabase, host Auth/API e usuário do PostgreSQL não correspondem.');
}
if (
  databaseUrl.searchParams.get('connection_limit') !== '1' ||
  databaseUrl.searchParams.get('pgbouncer') !== 'true'
) {
  throw new Error('Benchmark exige o pool existente de uma conexão e pgbouncer=true.');
}

const queryEvents = [];
const transactionSpans = [];
const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
prisma.$on('query', (event) => {
  const tables = [
    ...event.query.matchAll(
      /\b(?:FROM|JOIN)\s+(?:"([^"]+)"|([a-z0-9_]+))(?:\s*\.\s*(?:"([^"]+)"|([a-z0-9_]+)))?/gi,
    ),
  ]
    .map((match) => (match[3] ?? match[4] ?? match[1] ?? match[2]).toLowerCase())
    .filter((table) => !['select', 'lateral'].includes(table));
  const shape = event.query
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/\$\d+/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
  queryEvents.push({
    durationMs: event.duration,
    tables: [...new Set(tables)],
    operation:
      shape.match(/^(SELECT|WITH|INSERT|UPDATE|DELETE|BEGIN|COMMIT|SET|SHOW)/i)?.[1] ?? 'OTHER',
    signature: createHash('sha256').update(shape).digest('hex').slice(0, 12),
  });
});

const instrumentedPrisma = new Proxy(prisma, {
  get(target, property, receiver) {
    if (property !== '$transaction') return Reflect.get(target, property, receiver);
    return (operation, ...options) => {
      if (typeof operation !== 'function') return target.$transaction(operation, ...options);
      const calledAt = performance.now();
      let callbackStartedAt = calledAt;
      let callbackFinishedAt = calledAt;
      return target
        .$transaction(
          async (transaction) => {
            callbackStartedAt = performance.now();
            try {
              return await operation(transaction);
            } finally {
              callbackFinishedAt = performance.now();
            }
          },
          ...options,
        )
        .finally(() => {
          transactionSpans.push({
            acquisitionAndStartMs: Number((callbackStartedAt - calledAt).toFixed(1)),
            callbackMs: Number((callbackFinishedAt - callbackStartedAt).toFixed(1)),
            totalMs: Number((performance.now() - calledAt).toFixed(1)),
          });
        });
    };
  },
});

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function summarize(samples) {
  const times = samples.map((sample) => sample.durationMs).filter(Number.isFinite);
  return {
    sampleCount: samples.length,
    p50Ms: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    maxMs: times.length ? Math.max(...times) : null,
    failures: samples.filter((sample) => sample.status !== 'PASS').length,
  };
}

function querySummary(events) {
  const byShape = new Map();
  for (const event of events) {
    const value = byShape.get(event.signature) ?? {
      signature: event.signature,
      operation: event.operation,
      tables: event.tables,
      count: 0,
      durationMs: 0,
    };
    value.count += 1;
    value.durationMs += event.durationMs;
    byShape.set(event.signature, value);
  }
  return {
    count: events.length,
    clientToDatabaseResponseMs: Number(
      events.reduce((sum, event) => sum + event.durationMs, 0).toFixed(1),
    ),
    byOperation: events.reduce((result, event) => {
      result[event.operation] = (result[event.operation] ?? 0) + 1;
      return result;
    }, {}),
    shapes: [...byShape.values()].map((value) => ({
      ...value,
      durationMs: Number(value.durationMs.toFixed(1)),
    })),
  };
}

try {
  const organizations = await prisma.organization.findMany({
    where: { slug: { startsWith: runPrefix } },
    select: { id: true, slug: true, status: true },
    take: 20,
  });
  if (!organizations.length || organizations.some(({ slug }) => !slug.startsWith(runPrefix))) {
    throw new Error('Não foram encontradas organizações sintéticas para o prefixo fornecido.');
  }
  const organizationIds = organizations.map(({ id }) => id);
  const client = await prisma.client.findFirst({
    where: {
      organizationId: { in: organizationIds },
      deletedAt: null,
      receivables: { some: {} },
    },
    select: { id: true, organizationId: true },
  });
  if (!client) throw new Error('Nenhum cliente sintético com recebível foi encontrado.');
  const organization = organizations.find(({ id }) => id === client.organizationId);
  if (!organization) throw new Error('O fixture financeiro não pertence ao prefixo sintético.');

  const actor = {
    userId: 'qa-readonly-financial-overview-benchmark',
    organizationId: client.organizationId,
    permissions: [
      'matters:view',
      'contracts:view',
      'receivables:view',
      'payments:view',
      'documents:view',
      'tasks:view',
      'calendar:view',
      'notes:view',
      'messages:view',
      'audit:view',
    ],
  };
  const service = new ClientsService(instrumentedPrisma, {}, {});

  await prisma.$disconnect();
  queryEvents.length = 0;
  transactionSpans.length = 0;

  async function sample(label) {
    const eventStart = queryEvents.length;
    const transactionStart = transactionSpans.length;
    const startedAt = performance.now();
    try {
      const value = await service.overview(actor, client.id);
      const serializationStartedAt = performance.now();
      const serialized = JSON.stringify(value);
      const serializationMs = performance.now() - serializationStartedAt;
      return {
        label,
        status: 'PASS',
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        serializationMs: Number(serializationMs.toFixed(1)),
        serializedBytes: Buffer.byteLength(serialized),
        query: querySummary(queryEvents.slice(eventStart)),
        transaction: transactionSpans[transactionStart] ?? null,
        finance: {
          receivables: value.financial.receivables.length,
          payments: value.financial.payments.length,
          outstanding: value.financial.outstanding,
        },
      };
    } catch (error) {
      return {
        label,
        status: 'FAIL',
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        code: typeof error === 'object' && error && 'code' in error ? error.code : 'ERROR',
        query: querySummary(queryEvents.slice(eventStart)),
        transaction: transactionSpans[transactionStart] ?? null,
      };
    }
  }

  const cold = await sample('connection-cold-first-request');
  const warm = [];
  for (let index = 0; index < warmSamples; index += 1) warm.push(await sample('warm-sequential'));
  const concurrentStartedAt = performance.now();
  const concurrentEventStart = queryEvents.length;
  const concurrentTransactionStart = transactionSpans.length;
  const concurrent = await Promise.all([sample('concurrency-2-a'), sample('concurrency-2-b')]);
  const concurrency2 = {
    durationMs: Number((performance.now() - concurrentStartedAt).toFixed(1)),
    samples: concurrent,
    query: querySummary(queryEvents.slice(concurrentEventStart)),
    transactions: transactionSpans.slice(concurrentTransactionStart),
  };

  const siblingOrganization = organizations.find(({ id }) => id !== client.organizationId);
  let tenantIsolation = { status: 'BLOCKED', reason: 'fixture QA irmão não encontrado' };
  if (siblingOrganization) {
    try {
      await service.overview({ ...actor, organizationId: siblingOrganization.id }, client.id);
      tenantIsolation = { status: 'FAIL', reason: 'cliente de outra organização retornou dados' };
    } catch (error) {
      const status = typeof error?.getStatus === 'function' ? error.getStatus() : null;
      tenantIsolation =
        status === 404
          ? { status: 'PASS', reason: 'cliente de outra organização retornou 404' }
          : { status: 'FAIL', reason: 'organização irmã produziu erro inesperado' };
    }
  }

  const emptyClient = await prisma.client.findFirst({
    where: {
      organizationId: client.organizationId,
      deletedAt: null,
      receivables: { none: {} },
      payments: { none: {} },
    },
    select: { id: true },
  });
  let emptyFinance = {
    status: 'BLOCKED',
    reason: 'cliente sintético sem financeiro não encontrado',
  };
  if (emptyClient) {
    try {
      const value = await service.overview(actor, emptyClient.id);
      const empty =
        value.financial.receivables.length === 0 &&
        value.financial.payments.length === 0 &&
        value.financial.outstanding.length === 0;
      emptyFinance = empty
        ? { status: 'PASS', reason: 'listas e saldos financeiros vazios' }
        : { status: 'FAIL', reason: 'cliente vazio retornou movimentação financeira' };
    } catch (error) {
      emptyFinance = {
        status: 'FAIL',
        reason: typeof error === 'object' && error && 'code' in error ? error.code : 'ERROR',
      };
    }
  }

  const durations = warm.map(({ durationMs }) => durationMs);
  const serviceStatus =
    cold.status === 'PASS' &&
    warm.every(({ status }) => status === 'PASS') &&
    concurrent.every(({ status }) => status === 'PASS') &&
    tenantIsolation.status === 'PASS' &&
    emptyFinance.status === 'PASS'
      ? 'PASS'
      : 'FAIL';
  const http = {
    status: 'BLOCKED',
    reason:
      'Os tenants QA existentes estão arquivados, suas memberships estão suspensas e não há JWT ativo. Uma chamada autenticada também grava api_rate_limits no PostgreSQL compartilhado.',
    localHttpRequestSent: false,
  };
  const result = {
    status: serviceStatus === 'PASS' && http.status === 'PASS' ? 'PASS' : 'PARTIAL',
    environment: {
      projectRefMatchesAcrossSupabaseAndPostgres: true,
      databaseHost: databaseUrl.hostname,
      databasePort: databaseUrl.port || '5432',
      pool: {
        connectionLimit: databaseUrl.searchParams.get('connection_limit'),
        poolTimeoutSeconds: databaseUrl.searchParams.get('pool_timeout') ?? 'Prisma default',
        transactionPooler: databaseUrl.searchParams.get('pgbouncer') === 'true',
      },
      organizationStatus: organization.status,
      qaFixtureOnly: true,
      writesPerformed: false,
    },
    fixture: {
      syntheticOrganizationCount: organizations.length,
      syntheticClientHasReceivables: true,
    },
    service: {
      status: serviceStatus,
      cold,
      warm: {
        summary: {
          ...summarize(warm),
          p50Ms: Number((percentile(durations, 0.5) ?? 0).toFixed(1)),
          p95Ms: Number((percentile(durations, 0.95) ?? 0).toFixed(1)),
          maxMs: durations.length ? Number(Math.max(...durations).toFixed(1)) : null,
        },
        samples: warm,
      },
      concurrency2,
      tenantIsolation,
      emptyFinance,
    },
    http,
    methodology: {
      prismaEventDuration:
        'Tempo entre o Prisma emitir a consulta e receber a resposta; inclui caminho cliente-banco e não é CPU SQL isolada.',
      acquisitionAndStart:
        'Tempo de $transaction até o callback começar; agrega aquisição do pool, conexão fria e início da transação.',
      callback:
        'Tempo do callback da transação, incluindo comandos Prisma sequenciais na mesma conexão.',
      serialization:
        'JSON.stringify do objeto retornado pelo serviço; não inclui serialização Nest/HTTP.',
      percentile: 'Nearest-rank empírico, sem suavização ou remoção de outliers.',
    },
  };

  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'FAIL') process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
