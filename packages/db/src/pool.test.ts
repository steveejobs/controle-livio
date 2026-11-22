import { describe, expect, it } from 'vitest';
import { DatabasePool } from './pool';

describe('pg pool measurements', () => {
  it('preserves failed promise/callback acquisitions and records actual driver observations', async () => {
    const pool = new DatabasePool({
      host: '127.0.0.1',
      port: 1,
      user: 'synthetic',
      password: 'synthetic',
      database: 'synthetic',
      max: 1,
      connectionTimeoutMillis: 100,
    });
    try {
      expect(pool.snapshot().waitHistogram.count).toBe(0);
      await expect(pool.connect()).rejects.toBeInstanceOf(Error);
      await new Promise<void>((resolve, reject) => {
        pool.connect((error, client) => {
          try {
            expect(error).toBeInstanceOf(Error);
            expect(client).toBeUndefined();
            resolve();
          } catch (assertion) {
            reject(assertion);
          }
        });
      });
      const snapshot = pool.snapshot();
      expect(snapshot).toMatchObject({
        source: 'pg.pool.acquire',
        open: 0,
        waiting: 0,
        acquisitionErrors: 2,
        waitHistogram: { count: 2 },
      });
      expect(snapshot.waitHistogram.buckets.reduce((sum, [, count]) => sum + count, 0)).toBe(2);
      expect(snapshot.waitHistogram.sum).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(snapshot)).not.toContain('synthetic');
    } finally {
      await pool.end();
    }
  });
});
