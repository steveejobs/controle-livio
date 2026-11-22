import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySeedBootstrap } from './verify-seed-bootstrap.mjs';

// Creates its own native PostgreSQL development cluster. No incoming database
// URL, existing data directory, hosted endpoint or destructive cleanup is used.
assert.equal(
  process.argv[2],
  '--new-local-development',
  'Explicit new development cluster required',
);
assert.equal(process.platform, 'win32', 'This portable binary runner is for Windows');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const binaryRoot = join(
  process.env.LOCALAPPDATA,
  'LivioTools/postgres17/node_modules/@embedded-postgres/windows-x64/native/bin',
);
const pgctl = join(binaryRoot, 'pg_ctl.exe');
const initdb = join(binaryRoot, 'initdb.exe');
assert.ok(
  existsSync(pgctl) && existsSync(initdb),
  'Install the documented PostgreSQL 17 binary package first',
);
const privateRoot = mkdtempSync(join(tmpdir(), 'livio-prisma7-dev-'));
const data = join(privateRoot, 'data');
assert.equal(existsSync(data), false);
const password = randomBytes(32).toString('hex');
const passwordFile = join(privateRoot, 'synthetic-password');
writeFileSync(passwordFile, password + '\n', { mode: 0o600, flag: 'wx' });
const probe = createServer();
await new Promise((ok, fail) => probe.listen(0, '127.0.0.1', ok).once('error', fail));
const port = probe.address().port;
await new Promise((ok) => probe.close(ok));
const url = new URL(`postgresql://livio_dev:${password}@127.0.0.1:${port}/postgres`);
url.searchParams.set('connection_limit', '2');
url.searchParams.set('pool_timeout', '3');
url.searchParams.set('application_name', 'livio-prisma7-new-local-development');
const childEnv = { ...process.env, DATABASE_URL: url.href };
const command = (file, args, name) => {
  try {
    return execFileSync(file, args, {
      env: childEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 90_000,
      maxBuffer: 8 * 1024 * 1024,
    }).toString();
  } catch (error) {
    writeFileSync(
      join(privateRoot, name + '.log'),
      String(error.stdout ?? '') + String(error.stderr ?? ''),
      { mode: 0o600 },
    );
    throw new Error(`Owned development command failed: ${name}; private diagnostic retained`);
  }
};
const require = createRequire(import.meta.url);
const { PrismaClient, Prisma, postgresErrorCode } = require('@livio/db');
const { Client: PgClient } = require('pg');
const prismaCli = require.resolve('prisma/build/index.js');
const rows = [];
const report = {
  result: 'FAIL',
  environment: 'new native PostgreSQL development cluster; synthetic data only',
  scope: 'Prisma adapter/SQL, not hosted Supabase Auth/RLS/Storage or complete recovery',
  rows,
};
const evidence = resolve(root, 'test-results', 'prisma7-' + Date.now());
mkdirSync(evidence, { recursive: true });
let started = false;
let db;
let queued;
try {
  report.binarySha256 = createHash('sha256')
    .update(readFileSync(join(binaryRoot, 'postgres.exe')))
    .digest('hex');
  command(
    initdb,
    [
      '-D',
      data,
      '-U',
      'livio_dev',
      '--pwfile=' + passwordFile,
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
    ],
    'initdb',
  );
  // Windows descendants can retain pipe handles after pg_ctl has exited.
  // File descriptors keep startup bounded without waiting for server EOF.
  const startupLog = openSync(join(privateRoot, 'start.log'), 'wx', 0o600);
  let startup;
  try {
    startup = spawnSync(
      pgctl,
      [
        'start',
        '-D',
        data,
        '-l',
        join(privateRoot, 'postgres.log'),
        '-w',
        '-o',
        `-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12 -c timezone=UTC`,
      ],
      {
        env: childEnv,
        windowsHide: true,
        stdio: ['ignore', startupLog, startupLog],
        timeout: 90_000,
      },
    );
  } finally {
    closeSync(startupLog);
  }
  started = existsSync(join(data, 'postmaster.pid'));
  assert.equal(startup.status, 0, 'Owned PostgreSQL startup failed; private log retained');
  started = true;
  db = new PrismaClient({ connectionString: url.href });
  const [identity] =
    await db.$queryRaw`SELECT current_setting('data_directory') AS directory, current_setting('listen_addresses') AS listen, current_setting('port')::int AS port, current_setting('server_version') AS version, (SELECT system_identifier::text FROM pg_control_system()) AS cluster`;
  assert.equal(resolve(identity.directory), resolve(data));
  assert.equal(identity.listen, '127.0.0.1');
  assert.equal(identity.port, port);
  assert.match(identity.version, /^17\./);
  report.identity = { version: identity.version, port, cluster: identity.cluster };
  const [empty] =
    await db.$queryRaw`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'`;
  assert.equal(empty.count, 0, 'Only the newly initialized empty database may receive probe DDL');
  const ddl = command(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema',
      resolve(root, 'packages/db/prisma/schema.prisma'),
      '--script',
    ],
    'schema-diff',
  );
  assert.ok(ddl.includes('CREATE TABLE'));
  assert.equal(
    /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|RESET)\b/im.test(ddl),
    false,
    'Destructive probe DDL refused',
  );
  writeFileSync(join(privateRoot, 'schema.sql'), ddl, { mode: 0o600, flag: 'wx' });
  // pg simple-query protocol accepts CREATE-only multi-statement DDL. Every
  // connection option belongs to this fresh cluster, never an incoming URL.
  const schemaClient = new PgClient({
    host: '127.0.0.1',
    port,
    database: 'postgres',
    user: 'livio_dev',
    password,
    ssl: false,
    connectionTimeoutMillis: 3000,
  });
  try {
    await schemaClient.connect();
    await schemaClient.query(ddl);
  } finally {
    await schemaClient.end();
  }
  rows.push({ case: 'fresh-cluster-identity-and-create-only-schema', result: 'PASS' });
  const org = await db.organization.create({
    data: { legalName: 'Synthetic adapter proof', slug: 'adapter-' + randomUUID() },
  });
  const client = await db.client.create({
    data: {
      organizationId: org.id,
      type: 'PERSON',
      displayName: 'Synthetic client',
      customFields: { review: 'synthetic' },
    },
  });
  const amount = '900719925474099.1234';
  const contract = await db.contract.create({
    data: {
      organizationId: org.id,
      clientId: client.id,
      number: 'SYNTHETIC-1',
      title: 'Adapter proof',
      feeModel: 'FIXED',
      fixedAmount: new Prisma.Decimal(amount),
      startsAt: new Date('2026-11-22T00:00:00Z'),
    },
  });
  const [stored] =
    await db.$queryRaw`SELECT fixed_amount::text AS value FROM contracts WHERE id = ${contract.id}::uuid`;
  report.decimal = {
    input: amount,
    inputDecimal: new Prisma.Decimal(amount).toString(),
    stored: stored.value,
    returned: contract.fixedAmount.toString(),
  };
  assert.equal(contract.fixedAmount.toString(), amount);
  const joined = await db.client.findUniqueOrThrow({
    where: { id: client.id },
    include: { contracts: true },
  });
  assert.equal(joined.contracts[0].fixedAmount.toString(), amount);
  assert.equal(joined.contracts[0].startsAt.toISOString(), '2026-11-22T00:00:00.000Z');
  assert.deepEqual(joined.customFields, { review: 'synthetic' });
  rows.push({ case: 'decimal-date-json-and-related-records', result: 'PASS' });
  const { AuditService } = require(resolve(root, 'apps/api/dist/common/audit.service.js'));
  const { FinanceService } = require(resolve(root, 'apps/api/dist/finance/finance.service.js'));
  const { ClientsService } = require(resolve(root, 'apps/api/dist/clients/clients.service.js'));
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      fullName: 'Synthetic administrator',
      email: 'synthetic@example.test',
      status: 'ACTIVE',
    },
  });
  const actor = {
    organizationId: org.id,
    userId: user.id,
    isAdministrator: true,
    permissions: ['clients:view', 'contracts:view', 'receivables:view', 'payments:view'],
  };
  const finance = new FinanceService(db, new AuditService());
  const receivable = await finance.createReceivable(actor, {
    clientId: client.id,
    reference: 'SYNTHETIC-RECEIVABLE',
    description: 'Synthetic adapter ledger proof',
    originalAmount: '100.00',
    currency: 'BRL',
    issueDate: new Date('2026-11-20T00:00:00Z'),
    installments: [{ sequence: 1, amount: '100.00', dueDate: new Date('2026-11-21T00:00:00Z') }],
  });
  const installmentId = receivable.installments[0].id;
  const key = randomUUID();
  const paymentInput = {
    clientId: client.id,
    reference: 'SYNTHETIC-PARTIAL',
    amount: '33.34',
    currency: 'BRL',
    method: 'PIX',
    paidAt: new Date('2026-11-20T12:00:00Z'),
    allocations: [{ installmentId, amount: '33.34' }],
  };
  const partial = await finance.createPayment(actor, key, paymentInput);
  const repeated = await finance.createPayment(actor, key, paymentInput);
  assert.equal(partial.payment.id, repeated.payment.id);
  assert.equal(
    await db.payment.count({ where: { organizationId: org.id, idempotencyKey: key } }),
    1,
  );
  assert.equal(await db.paymentAllocation.count({ where: { installmentId } }), 1);
  assert.equal(
    (await db.receivableInstallment.findUniqueOrThrow({ where: { id: installmentId } })).status,
    'PARTIALLY_PAID',
  );
  rows.push({ case: 'real-finance-service-partial-payment-and-idempotency', result: 'PASS' });
  const completed = await finance.createPayment(actor, randomUUID(), {
    ...paymentInput,
    reference: 'SYNTHETIC-FULL',
    amount: '66.66',
    allocations: [{ installmentId, amount: '66.66' }],
  });
  assert.equal(
    (await db.receivableInstallment.findUniqueOrThrow({ where: { id: installmentId } })).status,
    'PAID',
  );
  assert.equal(
    (await db.receivable.findUniqueOrThrow({ where: { id: receivable.id } })).status,
    'PAID',
  );
  await finance.reversePayment(actor, completed.payment.id, { reason: 'Synthetic reversal proof' });
  const activeAllocations = await db.paymentAllocation.findMany({
    where: { installmentId, reversedAt: null, payment: { status: 'CONFIRMED' } },
  });
  assert.equal(
    activeAllocations
      .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0))
      .toFixed(4),
    '33.3400',
  );
  assert.equal(
    (await db.receivableInstallment.findUniqueOrThrow({ where: { id: installmentId } })).status,
    'PARTIALLY_PAID',
  );
  assert.equal(
    await db.paymentReversal.count({ where: { originalPaymentId: completed.payment.id } }),
    1,
  );
  assert.equal(
    await db.auditLog.count({
      where: { organizationId: org.id, resource: 'payment', action: 'CREATE' },
    }),
    2,
  );
  assert.equal(
    await db.auditLog.count({
      where: { organizationId: org.id, resource: 'payment', action: 'REVERSE' },
    }),
    1,
  );
  rows.push({ case: 'real-finance-service-settlement-reversal-and-audit', result: 'PASS' });
  const overview = await new ClientsService(db, undefined, undefined).overview(actor, client.id);
  assert.equal(overview.financial.outstanding[0].amount, '66.6600');
  assert.equal(overview.contracts[0].fixedAmount.toString(), amount);
  rows.push({ case: 'real-client-financial-overview-preserves-decimals', result: 'PASS' });
  const beforeRejectedPayments = await db.payment.count({ where: { organizationId: org.id } });
  const beforeRejectedAudit = await db.auditLog.count({ where: { organizationId: org.id } });
  await assert.rejects(
    finance.createPayment(actor, key, { ...paymentInput, reference: 'SYNTHETIC-CHANGED' }),
    (error) => error.getStatus?.() === 409,
  );
  await assert.rejects(
    finance.createPayment(actor, randomUUID(), {
      ...paymentInput,
      reference: 'SYNTHETIC-EXCESS',
      amount: '100.00',
      allocations: [{ installmentId, amount: '100.00' }],
    }),
    (error) => error.getStatus?.() === 400,
  );
  assert.equal(
    await db.payment.count({ where: { organizationId: org.id } }),
    beforeRejectedPayments,
  );
  assert.equal(await db.auditLog.count({ where: { organizationId: org.id } }), beforeRejectedAudit);
  rows.push({ case: 'real-finance-rejections-preserve-ledger-and-audit', result: 'PASS' });
  const foreign = await db.organization.create({
    data: { legalName: 'Synthetic foreign organization', slug: 'foreign-' + randomUUID() },
  });
  const foreignClient = await db.client.create({
    data: { organizationId: foreign.id, type: 'PERSON', displayName: 'Synthetic foreign client' },
  });
  await assert.rejects(
    new ClientsService(db, undefined, undefined).overview(actor, foreignClient.id),
    (error) => error.getStatus?.() === 404,
  );
  rows.push({ case: 'real-client-overview-foreign-organization-denied', result: 'PASS' });
  const clientService = new ClientsService(db, new AuditService(), undefined);
  const identityInput = {
    type: 'PERSON',
    displayName: 'Synthetic identity fixture',
    taxId: '529.982.247-25',
  };
  await clientService.create(actor, identityInput);
  const beforeDuplicateClientCount = await db.client.count({ where: { organizationId: org.id } });
  await assert.rejects(clientService.create(actor, identityInput), (error) => {
    report.duplicateClientError = {
      code: error.code ?? null,
      status: error.getStatus?.() ?? null,
      target: error.meta?.target ?? null,
      constraint: error.meta?.driverAdapterError?.cause?.constraint ?? null,
    };
    return error.getStatus?.() === 409;
  });
  assert.equal(
    await db.client.count({ where: { organizationId: org.id } }),
    beforeDuplicateClientCount,
  );
  rows.push({ case: 'real-client-tax-identity-conflict-preserved', result: 'PASS' });
  await assert.rejects(
    db.organization.create({ data: { legalName: 'Duplicate', slug: org.slug } }),
    (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
  );
  rows.push({ case: 'unique-constraint-error-identity', result: 'PASS' });
  for (const code of ['40001', '40P01', '42501', '23514']) {
    await assert.rejects(
      db.$executeRawUnsafe(
        `DO $$ BEGIN RAISE EXCEPTION 'Synthetic SQLSTATE probe' USING ERRCODE = '${code}'; END $$`,
      ),
      (error) => {
        report.rawSqlStates ??= [];
        report.rawSqlStates.push({ requested: code, prisma: error.code, meta: error.meta });
        return postgresErrorCode(error) === code;
      },
    );
  }
  rows.push({ case: 'raw-sql-driver-sqlstate-preserved', result: 'PASS' });
  const rolledBack = randomUUID();
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.organization.create({
        data: { id: rolledBack, legalName: 'Rollback', slug: 'rollback-' + rolledBack },
      });
      throw new Error('SYNTHETIC_ROLLBACK');
    }),
    /SYNTHETIC_ROLLBACK/,
  );
  assert.equal(await db.organization.findUnique({ where: { id: rolledBack } }), null);
  rows.push({ case: 'interactive-transaction-rollback', result: 'PASS' });
  let reached = 0;
  let release;
  const barrier = new Promise((ok) => {
    release = ok;
  });
  const concurrent = await Promise.allSettled(
    [1, 2].map((index) =>
      db.$transaction(
        async (tx) => {
          await tx.organization.findUniqueOrThrow({ where: { id: org.id } });
          if (++reached === 2) release();
          await barrier;
          return tx.organization.update({
            where: { id: org.id },
            data: { tradeName: 'Synthetic ' + index },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 5000,
          maxWait: 5000,
        },
      ),
    ),
  );
  assert.equal(concurrent.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = concurrent.find((item) => item.status === 'rejected');
  assert.equal(rejected.reason.code, 'P2034');
  rows.push({ case: 'serializable-concurrency-retry-signal', result: 'PASS' });
  const singleUrl = new URL(url);
  singleUrl.searchParams.set('connection_limit', '1');
  queued = new PrismaClient({ connectionString: singleUrl.href });
  await queued.$queryRaw`SELECT 1 AS ready`;
  let maxWaiting = 0;
  let maxOpen = 0;
  const sample = setInterval(() => {
    const snapshot = queued.getPoolMetrics();
    maxWaiting = Math.max(maxWaiting, snapshot.waiting);
    maxOpen = Math.max(maxOpen, snapshot.open);
  }, 2);
  try {
    await Promise.all(
      Array.from({ length: 4 }, () => queued.$queryRaw`SELECT pg_sleep(0.03) IS NULL AS complete`),
    );
  } finally {
    clearInterval(sample);
  }
  assert.ok(maxWaiting > 0);
  assert.equal(maxOpen, 1);
  const metrics = queued.getPoolMetrics();
  assert.ok(metrics.waitHistogram.count >= 5);
  assert.ok(metrics.waitHistogram.sum > 0);
  assert.equal(metrics.acquisitionErrors, 0);
  rows.push({
    case: 'bounded-pool-and-observed-acquisition-queue',
    result: 'PASS',
    maxWaiting,
    maxOpen,
  });
  rows.push(await verifySeedBootstrap({ root, privateRoot, connectionString: url.href }));
  report.result = 'PASS';
} catch (error) {
  report.failure = {
    name: error.name,
    code: error.code ?? null,
    message: String(error.message).trim().slice(0, 240),
  };
  writeFileSync(join(privateRoot, 'failure.log'), String(error.stack ?? error), {
    mode: 0o600,
    flag: 'wx',
  });
  process.exitCode = 1;
} finally {
  await Promise.allSettled([db?.$disconnect(), queued?.$disconnect()]);
  if (started) command(pgctl, ['stop', '-D', data, '-m', 'fast', '-w'], 'stop');
  report.clusterStopped = started;
  report.filesPreserved = true;
  writeFileSync(join(privateRoot, 'summary.json'), JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  writeFileSync(join(evidence, 'summary.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
}
console.log(JSON.stringify(report));
