import type { PoolConfig } from 'pg';

function integer(value: string | null, fallback: number, maximum: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('Configuração numérica do pool inválida.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum)
    throw new Error('Configuração numérica do pool fora dos limites.');
  return parsed;
}

export function databaseConnection(value: string | undefined): {
  pool: PoolConfig;
  schema: string;
} {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error('DATABASE_URL ausente ou inválida.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    !url.pathname.slice(1)
  )
    throw new Error('DATABASE_URL deve identificar usuário e banco PostgreSQL.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  const sslMode = url.searchParams.get('sslmode');
  if ((!local && sslMode === 'disable') || sslMode === 'no-verify')
    throw new Error('O banco remoto exige TLS com certificado validado.');
  const schema = url.searchParams.get('schema') ?? 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Schema PostgreSQL inválido.');
  try {
    return {
      schema,
      pool: {
        host,
        port: integer(url.port || null, 5432, 65535),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)),
        max: integer(url.searchParams.get('connection_limit'), 1, 100),
        // pg applies this bound to pool acquisition and connection setup.
        connectionTimeoutMillis:
          integer(
            url.searchParams.get('pool_timeout') ?? url.searchParams.get('connect_timeout'),
            10,
            300,
          ) * 1000,
        idleTimeoutMillis: 30_000,
        application_name: url.searchParams.get('application_name') ?? 'livio',
        options: url.searchParams.get('options') ?? undefined,
        ssl: local && (!sslMode || sslMode === 'disable') ? false : { rejectUnauthorized: true },
      },
    };
  } catch {
    // Do not propagate URL input/credentials in native parsing errors.
    throw new Error('Configuração da conexão PostgreSQL inválida.');
  }
}
