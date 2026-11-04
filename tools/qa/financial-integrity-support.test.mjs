import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  validateFinancialEnvironment,
  paymentPayload,
  expensePayload,
  reusableActors,
} from './financial-integrity-support.mjs';

const env = {
  LIVIO_FINANCIAL_INTEGRATION: 'disposable',
  NODE_ENV: 'test',
  SUPABASE_LOCAL: 'true',
  SUPABASE_ENVIRONMENT: 'test',
  DATABASE_URL: 'postgresql://ci:ci@127.0.0.1:54322/postgres',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001/v1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-local',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon',
  LIVIO_QA_OUTPUT: '/tmp/synthetic-evidence',
  CLAMAV_HOST: '127.0.0.1',
  CLAMAV_PORT: '13310',
};
test('pool isolado mantém pares distintos e suspensão usa identidade nova', async () => {
  let count = 0;
  const next = reusableActors(async (org, role) => ({ id: ++count, org, role }));
  for (let index = 0; index < 10; index += 1) {
    const peers = [await next('A'), await next('A'), await next('A')];
    assert.equal(new Set(peers.map((peer) => peer.id)).size, 3);
  }
  assert.equal(count, 6);
  const foreign = await next('B');
  assert.equal(foreign.org, 'B');
  const fresh = await next('A', 'administrator', undefined, true);
  assert.equal(fresh.id, 8);
  assert.notEqual((await next('A')).id, fresh.id);
});
test('preflight aceita exclusivamente a configuração explícita local', () => {
  assert.doesNotThrow(() => validateFinancialEnvironment(env, '.', () => false));
});
for (const [key, value] of [
  ['DATABASE_URL', undefined],
  ['DATABASE_URL', 'postgresql://ci:synthetic@shared.example.invalid/postgres'],
  ['DATABASE_URL', 'https://127.0.0.1/postgres'],
  ['NEXT_PUBLIC_API_URL', 'https://production.example.invalid/v1'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'https://shared.example.invalid'],
  ['NODE_ENV', 'production'],
  ['SUPABASE_ENVIRONMENT', 'production'],
  ['SUPABASE_LOCAL', 'false'],
  ['SUPABASE_ACCESS_TOKEN', 'synthetic-management-token'],
  ['SUPABASE_DB_PASSWORD', 'synthetic-password'],
  ['LIVIO_FINANCIAL_INTEGRATION', undefined],
  ['CLAMAV_HOST', 'scanner.example.invalid'],
])
  test(`preflight rejeita configuração insegura: ${key}/${String(value).split(':')[0]}`, () => {
    assert.throws(() => validateFinancialEnvironment({ ...env, [key]: value }, '.', () => false));
  });
test('preflight rejeita arquivos de ambiente em qualquer app', () => {
  assert.throws(() => validateFinancialEnvironment(env, '.', (path) => path.endsWith('.env')));
});
test('payloads gerados respeitam os schemas reais, sem coerção de dinheiro para number', () => {
  const require = createRequire(resolve('package.json'));
  const schemas = require(resolve('apps/api/dist/finance/finance.schemas.js'));
  const f = {
    clientId: '11000000-0000-4000-8000-000000000001',
    installmentId: '12000000-0000-4000-8000-000000000001',
  };
  const payment = schemas.createPaymentSchema.parse(paymentPayload(f, 'TESTE', '33.3400'));
  assert.equal(payment.amount, '33.3400');
  assert.equal(payment.allocations[0].amount, '33.3400');
  const expense = schemas.createExpenseSchema.parse(expensePayload(f.clientId, '12.1111'));
  assert.equal(expense.amount, '12.1111');
  assert.doesNotThrow(() =>
    schemas.createReceivableSchema.parse({
      clientId: f.clientId,
      reference: 'S3-FIXTURE',
      description: 'Saldo sintético',
      originalAmount: '100.00',
      currency: 'BRL',
      issueDate: '2035-01-01',
      installments: [{ sequence: 1, amount: '100.00', dueDate: '2035-01-31' }],
    }),
  );
  assert.doesNotThrow(() =>
    schemas.paymentChangeSchema.parse({
      ...paymentPayload(f, 'S3-CORRECTION', '30.00'),
      reason: 'Correção sintética',
    }),
  );
  assert.doesNotThrow(() =>
    schemas.renegotiationSchema.parse({
      reference: 'S3-REN',
      description: 'Renegociação sintética',
      reason: 'Nova condição sintética',
      issueDate: '2035-01-01',
      installments: [{ sequence: 1, amount: '100.00', dueDate: '2035-02-01' }],
    }),
  );
  const receiptSchemas = require(resolve('apps/api/dist/finance/receipt.schemas.js'));
  assert.doesNotThrow(() =>
    receiptSchemas.receiptConfirmationSchema.parse({
      amount: '70.00',
      paidAt: '2035-01-15T12:00:00Z',
      method: 'PIX',
      reference: 'S3-RECEIPT',
    }),
  );
});
