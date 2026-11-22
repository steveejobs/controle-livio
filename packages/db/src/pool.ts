import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { performance } from 'node:perf_hooks';
import { AsyncLocalStorage } from 'node:async_hooks';

const limits = [1, 5, 10, 50, 100, 500, 1000, 10_000, 300_000, Number.MAX_SAFE_INTEGER];
type PoolCallback = Parameters<Pool['connect']>[0];
type TransactionLease = { discard: boolean };

export type PoolMetrics = {
  source: 'pg.pool.acquire';
  waiting: number;
  busy: number;
  open: number;
  acquisitionErrors: number;
  waitHistogram: { count: number; sum: number; buckets: [number, number][] };
};

export class DatabasePool extends Pool {
  private readonly transactionLease = new AsyncLocalStorage<TransactionLease>();
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
    const lease = this.transactionLease.getStore();
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
        if (client && lease) this.guardRelease(client, lease);
        callback(error, client, client?.release ?? release);
      });
    }
    return super.connect().then(
      (client) => {
        record(undefined);
        if (lease) this.guardRelease(client, lease);
        return client;
      },
      (error: unknown) => {
        record(error);
        throw error;
      },
    );
  }

  withTransactionLease<T>(operation: (lease: TransactionLease) => Promise<T>): Promise<T> {
    const lease = { discard: false };
    return this.transactionLease.run(lease, () => operation(lease));
  }

  private guardRelease(client: PoolClient, lease: TransactionLease): void {
    const release = client.release.bind(client);
    client.release = (error) => release(error ?? (lease.discard || undefined));
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
