import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { Prisma, PrismaClient } = require('@livio/db');
const { ClientsService } = require('../../apps/api/dist/clients/clients.service.js');

const organizationId = process.env.QA_ORGANIZATION_ID;
const clientId = process.env.QA_CLIENT_ID;
const runPrefix = process.env.QA_RUN_PREFIX;
const outputPath = process.env.QA_BENCHMARK_OUTPUT;
if (!organizationId || !clientId || !runPrefix || !outputPath) {
  throw new Error('Informe IDs do fixture QA, prefixo QA e caminho de saída.');
}
if (!/^qa-workflows-[0-9]+-[a-f0-9]+-$/.test(runPrefix)) {
  throw new Error('O prefixo de organização precisa identificar uma execução QA sintética.');
}

const connection = new URL(process.env.DATABASE_URL);
const connectionOptions = {
  connectionLimit: connection.searchParams.get('connection_limit'),
  poolTimeout: connection.searchParams.get('pool_timeout'),
  pgbouncer: connection.searchParams.get('pgbouncer'),
};
if (connectionOptions.connectionLimit !== '1' || connectionOptions.pgbouncer !== 'true') {
  throw new Error('Benchmark exige o pool controlado de uma conexão via PgBouncer.');
}

const queryEvents = [];
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
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '?')
    .replace(/\s+/g, ' ')
    .trim();
  queryEvents.push({
    durationMs: event.duration,
    tables: [...new Set(tables)],
    operation:
      shape.match(/^(SELECT|WITH|INSERT|UPDATE|DELETE|BEGIN|COMMIT|SET|SHOW)/i)?.[1] ?? 'OTHER',
    signature: createHash('sha256').update(shape).digest('hex').slice(0, 12),
    sample: shape.slice(0, 180),
  });
});

try {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true },
  });
  if (!organization?.slug.startsWith(runPrefix)) {
    throw new Error('A organização não corresponde ao prefixo sintético do run QA.');
  }
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!client) throw new Error('Cliente sintético não pertence à organização indicada.');

  const actor = {
    userId: 'qa-readonly-financial-overview-benchmark',
    organizationId,
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
  const service = new ClientsService(prisma, {}, {});
  const sampleQueryStart = queryEvents.length;
  const concurrency = Number(process.env.QA_BENCHMARK_CONCURRENCY ?? 2);
  const iterations = Number(process.env.QA_BENCHMARK_ITERATIONS ?? 6);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new Error('Concorrência deve estar entre 1 e 3.');
  }
  if (!Number.isInteger(iterations) || iterations < concurrency || iterations > 6) {
    throw new Error('Iterações devem estar entre concorrência e 6.');
  }
  const samples = [];
  let firstOverview = null;

  for (let offset = 0; offset < iterations; offset += concurrency) {
    const batch = Array.from({ length: Math.min(concurrency, iterations - offset) }, async () => {
      const startedAt = performance.now();
      try {
        const value = await service.overview(actor, clientId);
        firstOverview ??= value;
        return { status: 'PASS', durationMs: Number((performance.now() - startedAt).toFixed(1)) };
      } catch (error) {
        return {
          status: 'FAIL',
          durationMs: Number((performance.now() - startedAt).toFixed(1)),
          code: typeof error === 'object' && error && 'code' in error ? error.code : 'ERROR',
        };
      }
    });
    samples.push(...(await Promise.all(batch)));
  }

  const benchmarkEvents = queryEvents.slice(sampleQueryStart);
  const durations = samples.map(({ durationMs }) => durationMs).sort((a, b) => a - b);
  const tableCounts = {};
  const queryShapes = new Map();
  const operationCounts = {};
  for (const event of benchmarkEvents) {
    for (const table of event.tables) tableCounts[table] = (tableCounts[table] ?? 0) + 1;
    operationCounts[event.operation] = (operationCounts[event.operation] ?? 0) + 1;
    const shape = queryShapes.get(event.signature) ?? {
      operation: event.operation,
      tables: event.tables,
      sample: event.sample,
      count: 0,
      totalDurationMs: 0,
    };
    shape.count += 1;
    shape.totalDurationMs += event.durationMs;
    queryShapes.set(event.signature, shape);
  }
  const queryDurations = benchmarkEvents.map(({ durationMs }) => durationMs);
  const siblingOrganizations = await prisma.organization.findMany({
    where: {
      id: { not: organizationId },
      slug: { startsWith: runPrefix.slice(0, -1) },
    },
    select: { id: true },
  });
  let organizationIsolation = { status: 'BLOCKED', result: 'fixture QA sibling not found' };
  if (siblingOrganizations[0]) {
    try {
      await service.overview({ ...actor, organizationId: siblingOrganizations[0].id }, clientId);
      organizationIsolation = { status: 'FAIL', result: 'foreign client overview returned data' };
    } catch (error) {
      const status =
        typeof error === 'object' &&
        error &&
        'getStatus' in error &&
        typeof error.getStatus === 'function'
          ? error.getStatus()
          : null;
      organizationIsolation =
        status === 404
          ? { status: 'PASS', result: 'foreign client returned 404' }
          : { status: 'FAIL', result: 'foreign client failed with unexpected error' };
    }
  }
  const emptyFinanceClient = await prisma.client.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      receivables: { none: {} },
      payments: { none: {} },
    },
    select: { id: true },
  });
  let emptyFinancialOffice = {
    status: 'BLOCKED',
    result: 'synthetic client without finance not found',
  };
  if (emptyFinanceClient) {
    try {
      const emptyOverview = await service.overview(actor, emptyFinanceClient.id);
      const isEmpty =
        emptyOverview.financial.receivables.length === 0 &&
        emptyOverview.financial.payments.length === 0 &&
        emptyOverview.financial.outstanding.length === 0;
      emptyFinancialOffice = isEmpty
        ? { status: 'PASS', result: 'empty receivables, payments and balances returned' }
        : { status: 'FAIL', result: 'financial rows present for empty synthetic client' };
    } catch (error) {
      emptyFinancialOffice = {
        status: 'FAIL',
        result: typeof error === 'object' && error && 'code' in error ? error.code : 'ERROR',
      };
    }
  }
  const receivables = firstOverview?.financial.receivables ?? [];
  const payments = firstOverview?.financial.payments ?? [];
  const originalAmount = receivables.reduce(
    (total, receivable) => total.plus(receivable.originalAmount),
    new Prisma.Decimal(0),
  );
  const result = {
    status:
      samples.every(({ status }) => status === 'PASS') &&
      organizationIsolation.status === 'PASS' &&
      emptyFinancialOffice.status === 'PASS'
        ? 'PASS'
        : 'FAIL',
    pool: connectionOptions,
    concurrency,
    samples,
    latencyMs: {
      min: durations[0] ?? null,
      median: durations.length ? durations[Math.floor((durations.length - 1) / 2)] : null,
      max: durations.at(-1) ?? null,
    },
    queryCount: benchmarkEvents.length,
    queryTimeMs: {
      total: Number(queryDurations.reduce((sum, value) => sum + value, 0).toFixed(1)),
      mean: queryDurations.length
        ? Number(
            (queryDurations.reduce((sum, value) => sum + value, 0) / queryDurations.length).toFixed(
              1,
            ),
          )
        : null,
      max: queryDurations.length ? Math.max(...queryDurations) : null,
    },
    queriesByTable: tableCounts,
    queriesByOperation: operationCounts,
    queryShapes: [...queryShapes.values()].map((shape) => ({
      ...shape,
      totalDurationMs: Number(shape.totalDurationMs.toFixed(1)),
    })),
    financial: {
      receivableCountReturned: receivables.length,
      originalAmountReturned: originalAmount.toFixed(2),
      receivables: receivables.map((receivable) => ({
        currency: receivable.currency,
        originalAmount: receivable.originalAmount.toString(),
        status: receivable.status,
        installments: receivable.installments.map((installment) => ({
          amount: installment.amount.toString(),
          status: installment.status,
          allocated: installment.allocations
            .reduce((total, allocation) => total.plus(allocation.amount), new Prisma.Decimal(0))
            .toFixed(2),
        })),
      })),
      payments: payments.map(({ amount, currency, status }) => ({
        amount: amount.toString(),
        currency,
        status,
      })),
      outstanding: firstOverview?.financial.outstanding ?? null,
      reportConsistency: firstOverview?.financial.outstanding.some(
        ({ currency, amount }) => currency === 'BRL' && amount === '880.0000',
      )
        ? 'PASS: synthetic QA report previously aggregated BRL 880.00'
        : 'NOT_CONFIRMED',
    },
    checks: { organizationIsolation, emptyFinancialOffice },
    returnedCounts: firstOverview
      ? {
          matters: firstOverview.matters.length,
          contracts: firstOverview.contracts.length,
          receivables: firstOverview.financial.receivables.length,
          payments: firstOverview.financial.payments.length,
          documents: firstOverview.documents.length,
          tasks: firstOverview.tasks.length,
          upcomingEvents: firstOverview.upcomingEvents.length,
          internalNotes: firstOverview.internalNotes.length,
          clientMessages: firstOverview.clientMessages.length,
          timeline: firstOverview.timeline.length,
        }
      : null,
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'PASS') process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
