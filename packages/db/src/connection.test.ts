import { describe, expect, it } from 'vitest';
import { databaseConnection } from './connection';

describe('PostgreSQL adapter configuration', () => {
  it('preserves pool, schema, identity and application settings from a Supavisor URL', () => {
    const connection = databaseConnection(
      'postgresql://postgres.example:p%40ss@aws-0.pooler.supabase.com:6543/postgres?schema=public&pgbouncer=true&connection_limit=4&pool_timeout=12&application_name=isolated-proof',
    );
    expect(connection.schema).toBe('public');
    expect(connection.pool).toMatchObject({
      host: 'aws-0.pooler.supabase.com',
      port: 6543,
      user: 'postgres.example',
      password: 'p@ss',
      database: 'postgres',
      max: 4,
      connectionTimeoutMillis: 12_000,
      idleTimeoutMillis: 30_000,
      application_name: 'isolated-proof',
      ssl: { rejectUnauthorized: true },
    });
  });

  it('uses a bounded default pool and allows unencrypted connections only on loopback', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      const { pool } = databaseConnection(`postgresql://test:synthetic@${host}:54322/test`);
      expect(pool.max).toBe(1);
      expect(pool.connectionTimeoutMillis).toBe(10_000);
      expect(pool.ssl).toBe(false);
    }
    expect(
      databaseConnection('postgresql://test:synthetic@localhost/test?sslmode=require').pool.ssl,
    ).toEqual({ rejectUnauthorized: true });
  });

  it.each([
    undefined,
    'not-a-url',
    'https://test:synthetic@example.test/test',
    'postgresql://test:synthetic@example.test/test?sslmode=disable',
    'postgresql://test:synthetic@localhost/test?sslmode=no-verify',
    'postgresql://test:synthetic@localhost/test?connection_limit=0',
    'postgresql://test:synthetic@localhost/test?connection_limit=101',
    'postgresql://test:synthetic@localhost/test?pool_timeout=0',
    'postgresql://test:synthetic@localhost/test?pool_timeout=NaN',
    'postgresql://test:synthetic@localhost/test?schema=public%3BSELECT',
  ])('rejects invalid connection options without disclosing the URL: %s', (value) => {
    let failure: unknown;
    try {
      databaseConnection(value);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain('synthetic');
    expect(String(failure)).not.toContain('postgresql://');
    expect(failure).not.toHaveProperty('input');
  });
});
