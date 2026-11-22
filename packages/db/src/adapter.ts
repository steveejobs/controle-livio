import { PrismaPg } from '@prisma/adapter-pg';
import type { Prisma } from './generated/client';
import type { DatabasePool } from './pool';

export function databaseAdapter(
  pool: DatabasePool,
  schema: string,
): NonNullable<Prisma.PrismaClientOptions['adapter']> {
  const factory = new PrismaPg(pool, { schema, disposeExternalPool: true });
  // Compose the public adapter interfaces. A rollback discards its leased
  // connection, including when termination races the driver's error event.
  // Successful transactions keep pooling; no write is automatically replayed.
  return {
    provider: factory.provider,
    adapterName: factory.adapterName,
    async connect() {
      const driver = await factory.connect();
      return {
        provider: driver.provider,
        adapterName: driver.adapterName,
        queryRaw: driver.queryRaw.bind(driver),
        executeRaw: driver.executeRaw.bind(driver),
        executeScript: driver.executeScript.bind(driver),
        getConnectionInfo: driver.getConnectionInfo.bind(driver),
        dispose: driver.dispose.bind(driver),
        startTransaction: (isolationLevel) =>
          pool.withTransactionLease(async (lease) => {
            const tx = await driver.startTransaction(isolationLevel);
            return {
              provider: tx.provider,
              adapterName: tx.adapterName,
              options: tx.options,
              queryRaw: tx.queryRaw.bind(tx),
              executeRaw: tx.executeRaw.bind(tx),
              commit: tx.commit.bind(tx),
              rollback: () => {
                lease.discard = true;
                return tx.rollback();
              },
              createSavepoint: tx.createSavepoint?.bind(tx),
              rollbackToSavepoint: tx.rollbackToSavepoint?.bind(tx),
              releaseSavepoint: tx.releaseSavepoint?.bind(tx),
            };
          }),
      };
    },
  };
}
