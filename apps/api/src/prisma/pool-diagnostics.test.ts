import { describe, expect, it } from 'vitest';
import {
  summarizePoolGauges,
  summarizePoolWaitHistogram,
  summarizeQueryShape,
  type PoolMetrics,
} from './pool-diagnostics';

describe('Prisma pool diagnostics', () => {
  it('reports pool gauges without exposing query values', () => {
    const metrics = {
      gauges: [
        { key: 'prisma_client_queries_wait', value: 2 },
        { key: 'prisma_pool_connections_busy', value: 3 },
        { key: 'prisma_pool_connections_open', value: 3 },
      ],
      histograms: [
        {
          key: 'prisma_client_queries_wait_histogram_ms',
          value: { buckets: [[1, 1]], count: 1, sum: 0.2 },
        },
      ],
      counters: [],
    } as unknown as PoolMetrics;

    expect(summarizePoolGauges(metrics)).toEqual({ waiting: 2, busy: 3, open: 3 });
    expect(summarizePoolWaitHistogram(metrics)).toEqual({
      buckets: [[1, 1]],
      count: 1,
      sum: 0.2,
    });
  });

  it('records query operation and table names but not literal values', () => {
    const summary = summarizeQueryShape(
      `SELECT "u"."id" FROM "public"."users" AS "u" WHERE "u"."email" = 'qa@example.test' AND "u"."id" = $1`,
    );

    expect(summary.operation).toBe('SELECT');
    expect(summary.tables).toEqual(['users']);
    expect(JSON.stringify(summary)).not.toContain('qa@example.test');
    expect(summary.signature).toMatch(/^[a-f0-9]{12}$/);
  });
});
