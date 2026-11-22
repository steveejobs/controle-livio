import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { performance } from 'node:perf_hooks';

const limits = [1, 5, 10, 50, 100, 500, 1000, 10_000, 300_000, Number.MAX_SAFE_INTEGER];
type PoolCallback = Parameters<Pool['connect']>[0];

export type PoolMetrics = {
  source: 'pg.pool.acquire';
  waiting: number;
  busy: number;
  open: number;
  acquisitionErrors: number;
  waitHistogram: { count: number; sum: number; buckets: [number, number][] };
};

export class DatabasePool extends Pool {
  private readonly buckets = limits.map(() => 0);
  private acquisitions = 0;
  private acquisitionMilliseconds = 0;
  private acquisitionErrors = 0;

  constructor(config: PoolConfig) {
    super(config);
    this.on('error', () => {
      process.stderr.write('{"event":"database_idle_connection_error"}\n');
    });
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: PoolCallback): void;
  override connect(callback?: PoolCallback): Promise<PoolClient> | void {
    const started = performance.now();
    const record = (error: unknown) => {
      const elapsed = Math.max(0, performance.now() - started);
      this.acquisitions += 1;
      this.acquisitionMilliseconds += elapsed;
      if (error) this.acquisitionErrors += 1;
      const bucket = limits.findIndex((limit) => elapsed <= limit);
      if (bucket >= 0) this.buckets[bucket] = (this.buckets[bucket] ?? 0) + 1;
    };
    if (callback) {
      return super.connect((error, client, release) => {
        record(error);
        callback(error, client, release);
      });
    }
    return super.connect().then(
      (client) => {
        record(undefined);
        return client;
      },
      (error: unknown) => {
        record(error);
        throw error;
      },
    );
  }

  snapshot(): PoolMetrics {
    return {
      source: 'pg.pool.acquire',
      waiting: this.waitingCount,
      busy: this.totalCount - this.idleCount,
      open: this.totalCount,
      acquisitionErrors: this.acquisitionErrors,
      waitHistogram: {
        count: this.acquisitions,
        sum: this.acquisitionMilliseconds,
        buckets: limits.map((limit, index) => [limit, this.buckets[index] ?? 0]),
      },
    };
  }
}
