import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function validateFinancialEnvironment(env, root, exists = existsSync) {
  if (env.CLAMAV_HOST !== '127.0.0.1' || env.CLAMAV_PORT !== '13310')
    throw new Error('Financial QA requires the disposable runner scanner.');
  if (
    env.LIVIO_FINANCIAL_INTEGRATION !== 'disposable' ||
    env.NODE_ENV !== 'test' ||
    env.SUPABASE_LOCAL !== 'true' ||
    env.SUPABASE_ENVIRONMENT !== 'test' ||
    env.SUPABASE_ACCESS_TOKEN ||
    env.SUPABASE_DB_PASSWORD
  )
    throw new Error('Financial QA requires explicit disposable test configuration.');
  for (const [key, protocols] of [
    ['DATABASE_URL', ['postgres:', 'postgresql:']],
    ['NEXT_PUBLIC_API_URL', ['http:']],
    ['NEXT_PUBLIC_SUPABASE_URL', ['http:']],
  ]) {
    let url;
    try {
      url = new URL(env[key]);
    } catch {
      throw new Error(`Missing or invalid ${key}.`);
    }
    if (
      !protocols.includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    )
      throw new Error(`Non-loopback ${key} refused.`);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.LIVIO_QA_OUTPUT)
    throw new Error('Disposable Auth credentials and evidence directory are required.');
  for (const dir of ['', 'apps/api', 'apps/web']) {
    for (const name of [
      '.env',
      '.env.local',
      '.env.test',
      '.env.test.local',
      '.env.production',
      '.env.production.local',
      '.env.development',
      '.env.development.local',
    ])
      if (exists(resolve(root, dir, name)))
        throw new Error('Local environment files are forbidden.');
  }
}

export function paymentPayload(fixture, reference, amount, paidAt = '2035-01-15T12:00:00Z') {
  return {
    clientId: fixture.clientId,
    reference,
    amount,
    currency: 'BRL',
    paidAt,
    method: 'PIX',
    allocations: [{ installmentId: fixture.installmentId, amount }],
  };
}

export function expensePayload(clientId, amount = '25.00', date = '2035-01-15T12:00:00Z') {
  return {
    clientId,
    description: 'Despesa sintética etapa 3',
    category: 'AUDIT_STAGE3',
    amount,
    currency: 'BRL',
    incurredAt: date,
    dueDate: date,
    reimbursable: false,
  };
}

// Reuse a small private test pool to respect real Auth limits. Six administrators
// keep concurrent peers/independent approvers distinct without dozens of logins.
export function reusableActors(factory) {
  const pools = new Map();
  return async (organizationId, roleKey = 'administrator', clientId, fresh = false) => {
    if (fresh) return factory(organizationId, roleKey, clientId);
    const key = JSON.stringify([organizationId, roleKey, clientId ?? null]);
    const pool = pools.get(key) ?? { actors: [], cursor: 0 };
    pools.set(key, pool);
    const size = roleKey === 'administrator' ? 6 : 1;
    if (pool.actors.length < size) {
      const actor = await factory(organizationId, roleKey, clientId);
      pool.actors.push(actor);
      pool.cursor += 1;
      return actor;
    }
    return pool.actors[pool.cursor++ % pool.actors.length];
  };
}
