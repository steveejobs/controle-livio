import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const required = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`QA: variável ${key} ausente`);
  return value;
};

const projectRef = required('QA_PROJECT_REF');
const supabaseUrl = required('SUPABASE_URL');
const apiUrl = required('QA_API_URL').replace(/\/$/, '');
const orgSlug = required('QA_ORG_SLUG');
if (!['development', 'test'].includes(required('SUPABASE_ENVIRONMENT'))) {
  throw new Error('QA ao vivo exige SUPABASE_ENVIRONMENT development/test');
}
if (
  projectRef !== required('SUPABASE_PROJECT_REF') ||
  !new URL(supabaseUrl).hostname.startsWith(`${projectRef}.`)
) {
  throw new Error('QA: project ref não corresponde à URL Supabase');
}
if (!orgSlug.startsWith('qa-')) throw new Error('QA: organização precisa ter prefixo qa-');
if (!apiUrl.startsWith('https://')) throw new Error('QA: API deve usar HTTPS');

const prisma = new PrismaClient();
const admin = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const publicClient = createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function authenticate(email) {
  const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (generated.error || !generated.data?.properties.hashed_token) {
    throw generated.error ?? new Error('QA: token de teste indisponível');
  }
  const verified = await publicClient.auth.verifyOtp({
    token_hash: generated.data.properties.hashed_token,
    type: 'magiclink',
  });
  if (verified.error || !verified.data.session?.access_token) {
    throw verified.error ?? new Error('QA: login de teste falhou');
  }
  return verified.data.session.access_token;
}

async function run() {
  const organization = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      memberships: {
        where: { status: 'ACTIVE' },
        select: {
          clientId: true,
          profile: { select: { email: true } },
          roles: { select: { role: { select: { key: true } } } },
        },
      },
    },
  });
  assert.ok(organization, 'Organização QA não encontrada');
  const adminMember = organization.memberships.find((member) =>
    member.roles.some(({ role }) => role.key === 'administrator'),
  );
  assert.ok(adminMember, 'Administrador QA não encontrado');
  const token = await authenticate(adminMember.profile.email);
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Organization-Id': organization.id,
  };
  const checked = [];
  async function check(path, expected = 200, format = 'json') {
    const response = await fetch(`${apiUrl}${path}`, { headers, cache: 'no-store' });
    assert.equal(response.status, expected, `${path}: HTTP ${response.status}`);
    if (expected === 200) {
      const body = format === 'csv' ? await response.text() : await response.json();
      assert.ok(body !== undefined, `${path}: resposta vazia`);
    }
    checked.push(path);
  }

  await check('/auth/me');
  const collections = [
    '/dashboard/summary',
    '/clients?page=1&pageSize=25',
    '/matters?page=1&pageSize=25',
    '/pipelines',
    '/tasks',
    '/calendar-events',
    '/documents?page=1&pageSize=25',
    '/finance/contracts?page=1&pageSize=25',
    '/finance/receivables?page=1&pageSize=25',
    '/finance/payments?page=1&pageSize=25',
    '/finance/expenses?page=1&pageSize=25',
    '/notifications',
    '/admin/users',
    '/admin/roles',
    '/audit-logs?page=1&pageSize=25',
  ];
  for (const path of collections) await check(path);
  const reports = [
    'receivables-due',
    'received',
    'accrual',
    'overdue',
    'aging',
    'cash-forecast',
    'partial-payments',
    'active-contracts',
    'revenue-by-lawyer',
    'revenue-by-service',
    'delinquent-clients',
    'reconciliation',
  ];
  for (const report of reports) {
    const range = ['receivables-due', 'received', 'accrual'].includes(report)
      ? '?from=2026-01-01&to=2027-01-01&groupBy=month'
      : '';
    await check(`/reports/${report}${range}`);
  }
  await check(
    '/reports/receivables-due/export.csv?from=2026-01-01&to=2027-01-01&groupBy=month',
    200,
    'csv',
  );
  await check('/notifications/cron', 401);
  const clientMember = organization.memberships.find(
    (member) => member.clientId && member.roles.some(({ role }) => role.key === 'client'),
  );
  assert.ok(clientMember, 'Cliente QA não encontrado');
  const clientToken = await authenticate(clientMember.profile.email);
  const clientHeaders = {
    Authorization: `Bearer ${clientToken}`,
    'X-Organization-Id': organization.id,
  };
  async function checkClient(path, expected) {
    const response = await fetch(`${apiUrl}${path}`, { headers: clientHeaders, cache: 'no-store' });
    assert.equal(response.status, expected, `Portal ${path}: HTTP ${response.status}`);
    checked.push(`portal ${path}`);
  }
  await checkClient('/auth/me', 200);
  await checkClient(`/client-messages?clientId=${clientMember.clientId}`, 200);
  await checkClient(`/documents?clientId=${clientMember.clientId}&page=1&pageSize=25`, 200);
  await checkClient(`/internal-notes?clientId=${clientMember.clientId}`, 403);
  await checkClient('/admin/users', 403);
  console.log(`QA real: ${checked.length} rotas verificadas na organização ${orgSlug}.`);
}

try {
  await run();
} finally {
  await publicClient.auth.signOut();
  await prisma.$disconnect();
}
