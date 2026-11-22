import { databaseAdapter } from './adapter';
import { PrismaClient as GeneratedPrismaClient, type Prisma } from './generated/client';
import { databaseConnection } from './connection';
import { DatabasePool, type PoolMetrics } from './pool';

export type { PoolMetrics } from './pool';
type ClientOptions = Omit<Prisma.PrismaClientOptions, 'adapter' | 'accelerateUrl'> & {
  connectionString?: string;
};

export class PrismaClient extends GeneratedPrismaClient<
  Prisma.PrismaClientOptions & { log: Prisma.LogDefinition[] }
> {
  private readonly databasePool: DatabasePool;

  constructor({ connectionString = process.env.DATABASE_URL, ...options }: ClientOptions = {}) {
    const connection = databaseConnection(connectionString);
    const pool = new DatabasePool(connection.pool);
    super({
      ...options,
      log: (options.log ?? []).map((entry) =>
        typeof entry === 'string' ? { emit: 'stdout', level: entry } : entry,
      ),
      adapter: databaseAdapter(pool, connection.schema),
    });
    this.databasePool = pool;
  }

  getPoolMetrics(): PoolMetrics {
    return this.databasePool.snapshot();
  }
}
