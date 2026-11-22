import { createHash } from 'node:crypto';
import type { PoolMetrics } from '@livio/db';
export type { PoolMetrics } from '@livio/db';

export type PoolGaugeSnapshot = {
  waiting: number;
  busy: number;
  open: number;
};

export function summarizePoolGauges(metrics: PoolMetrics): PoolGaugeSnapshot {
  return {
    waiting: metrics.waiting,
    busy: metrics.busy,
    open: metrics.open,
  };
}

export function summarizePoolWaitHistogram(metrics: PoolMetrics) {
  return metrics.waitHistogram;
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
