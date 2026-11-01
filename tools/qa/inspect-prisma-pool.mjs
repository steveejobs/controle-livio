import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const expectedProjectRef = 'ioebcdpyrszokdyaoaqv';
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
const supabaseUrl = new URL(process.env.SUPABASE_URL ?? '');
const databaseMatches =
  databaseUrl.hostname === `db.${expectedProjectRef}.supabase.co` ||
  (databaseUrl.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(databaseUrl.username).includes(expectedProjectRef));
assert.equal(databaseMatches, true, 'DATABASE_URL não corresponde ao projeto autorizado.');
assert.equal(supabaseUrl.hostname, `${expectedProjectRef}.supabase.co`);

const prisma = new PrismaClient();
try {
  const identity = await prisma.$queryRaw`
    SELECT current_database() AS database,
           current_setting('server_version') AS server_version,
           current_setting('max_connections')::int AS max_connections,
           current_setting('superuser_reserved_connections')::int AS reserved_connections`;
  const metrics = await prisma.$metrics.json();
  const poolGauges = metrics.gauges
    .filter((metric) => /queries_wait|pool_connections_(open|busy|idle)/.test(metric.key))
    .map(({ key, value }) => ({ key, value }));
  const waitHistograms = metrics.histograms
    .filter((metric) => /wait/.test(metric.key))
    .map(({ key, value }) => ({ key, value }));
  console.log(
    JSON.stringify(
      {
        projectRef: expectedProjectRef,
        databaseHost: databaseUrl.hostname,
        databasePort: databaseUrl.port,
        pgbouncerTransactionMode: databaseUrl.searchParams.get('pgbouncer') === 'true',
        configuredConnectionLimit: databaseUrl.searchParams.get('connection_limit'),
        configuredPoolTimeoutSeconds:
          databaseUrl.searchParams.get('pool_timeout') ?? '10 (default)',
        identity: identity[0],
        poolGauges,
        waitHistograms,
        readOnly: true,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
