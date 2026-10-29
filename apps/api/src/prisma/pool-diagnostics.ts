import { createHash } from 'node:crypto';
import type { PrismaClient } from '@livio/db';

export type PoolMetrics = Awaited<ReturnType<PrismaClient['$metrics']['json']>>;

export type PoolGaugeSnapshot = {
  waiting: number;
  busy: number;
  open: number;
};

export function summarizePoolGauges(metrics: PoolMetrics): PoolGaugeSnapshot {
  const value = (key: string) => metrics.gauges.find((metric) => metric.key === key)?.value ?? 0;
  return {
    waiting: value('prisma_client_queries_wait'),
    busy: value('prisma_pool_connections_busy'),
    open: value('prisma_pool_connections_open'),
  };
}

export function summarizePoolWaitHistogram(metrics: PoolMetrics) {
  return (
    metrics.histograms.find((metric) => metric.key === 'prisma_client_queries_wait_histogram_ms')
      ?.value ?? null
  );
}

export function summarizeQueryShape(query: string) {
  const normalized = query
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/\$\d+/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
  const operation = normalized.match(/^(SELECT|WITH|INSERT|UPDATE|DELETE|BEGIN|COMMIT|SET)/i)?.[1];
  const tables = [
    ...normalized.matchAll(
      /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:"?([a-z0-9_]+)"?\.)?"?([a-z0-9_]+)"?/gi,
    ),
  ]
    .map((match) => (match[2] ?? match[1] ?? '').toLowerCase())
    .filter((table) => Boolean(table) && !['lateral', 'select', 'set', 'values'].includes(table));
  return {
    operation: operation?.toUpperCase() ?? 'OTHER',
    tables: [...new Set(tables)],
    signature: createHash('sha256').update(normalized).digest('hex').slice(0, 12),
  };
}
