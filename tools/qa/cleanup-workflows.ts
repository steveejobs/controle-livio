import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const allowedProjectRef = 'ioebcdpyrszokdyaoaqv';
const runIds = [
  '1793138640111-10b404',
  '1793139303947-ff2348',
  '1793140092989-ca5a80',
  '1793140814330-a4f327',
  '1793141782072-70c057',
] as const;
const organizationTables = [
  'users',
  'organization_members',
  'organization_member_roles',
  'roles',
  'permissions',
  'user_roles',
  'role_permissions',
  'sessions',
  'password_reset_tokens',
  'clients',
  'client_contacts',
  'pipelines',
  'pipeline_stages',
  'matters',
  'matter_parties',
  'matter_stage_history',
  'contracts',
  'service_catalog_items',
  'receivables',
  'receivable_installments',
  'payments',
  'payment_reversals',
  'payment_change_requests',
  'payment_allocations',
  'financial_adjustments',
  'renegotiations',
  'expenses',
  'documents',
  'document_versions',
  'document_signing_requests',
  'internal_notes',
  'client_messages',
  'tasks',
  'task_comments',
  'task_reminders',
  'task_history',
  'api_rate_limits',
  'calendar_events',
  'notifications',
  'web_push_subscriptions',
  'audit_logs',
  'activity_events',
] as const;
const bucketNames = ['legal-documents', 'document-signatures', 'client-photos'] as const;
const immutableTables = [
  'audit_logs',
  'matter_stage_history',
  'payment_reversals',
  'document_versions',
  'task_history',
] as const;
if (process.argv.includes('--apply'))
  throw new Error(
    'Remoção física desabilitada: o banco protege histórico imutável. O script é somente leitura.',
  );

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`QA cleanup bloqueado: configure ${name}.`);
  return value;
};

assert.equal(process.env.SUPABASE_ENVIRONMENT, 'test');
assert.equal(process.env.QA_ALLOW_SHARED_DATABASE_WRITES, 'true');
assert.equal(process.env.QA_EXTERNAL_DELIVERY_DISABLED, 'true');
for (const name of [
  'QA_PROJECT_REF',
  'SUPABASE_PROJECT_REF',
  'CONFIRM_SUPABASE_PROJECT_REF',
  'PRODUCTION_SUPABASE_PROJECT_REF',
])
  assert.equal(required(name), allowedProjectRef, `QA cleanup bloqueado: ${name} divergente.`);

const supabaseUrl = new URL(required('SUPABASE_URL'));
const databaseUrl = new URL(required('DATABASE_URL'));
assert.equal(supabaseUrl.hostname, `${allowedProjectRef}.supabase.co`);
assert.ok(
  databaseUrl.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(databaseUrl.username).includes(allowedProjectRef),
  'QA cleanup bloqueado: identidade real do PostgreSQL não corresponde ao alvo autorizado.',
);
const outboundVariables = Object.keys(process.env).filter(
  (name) =>
    /^(SMTP_|EMAIL_|MAIL_|RESEND_|SENDGRID_|MAILGUN_|VAPID_|STRIPE_|PAYMENT_|MERCADOPAGO_|PAGARME_|PAGSEGURO_|ASAAS_|EFI_|WHATSAPP_|META_|WEBHOOK_)/i.test(
      name,
    ) || name === 'CRON_SECRET',
);
assert.deepEqual(
  outboundVariables.filter((name) => process.env[name]),
  [],
);
assert.deepEqual(
  Object.keys(process.env).filter((name) =>
    /^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET|PRIVATE_KEY|ACCESS_TOKEN)/i.test(name),
  ),
  [],
);

const prisma = new PrismaClient();
const supabase = createClient(supabaseUrl.origin, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
type ForeignKey = { childTable: string; parentTable: string };
type StorageObject = { bucket: string; name: string };

function tableDeleteOrder(edges: ForeignKey[]): string[] {
  const incomingChildren = new Map<string, number>(organizationTables.map((table) => [table, 0]));
  const childrenByParent = new Map<string, string[]>();
  for (const { childTable, parentTable } of edges) {
    if (childTable === parentTable) continue;
    incomingChildren.set(parentTable, (incomingChildren.get(parentTable) ?? 0) + 1);
    childrenByParent.set(parentTable, [...(childrenByParent.get(parentTable) ?? []), childTable]);
  }
  const ready = organizationTables.filter((table) => incomingChildren.get(table) === 0);
  const result: string[] = [];
  while (ready.length) {
    const child = ready.shift()!;
    result.push(child);
    for (const parent of edges
      .filter((edge) => edge.childTable === child && edge.parentTable !== child)
      .map(({ parentTable }) => parentTable)) {
      const remaining = (incomingChildren.get(parent) ?? 0) - 1;
      incomingChildren.set(parent, remaining);
      if (remaining === 0) ready.push(parent as (typeof organizationTables)[number]);
    }
  }
  assert.deepEqual(
    [...result].sort(),
    [...organizationTables].sort(),
    'QA cleanup bloqueado: relacionamentos entre tabelas não permitem uma ordem segura de remoção.',
  );
  return result;
}

async function main() {
  const databaseIdentity = await prisma.$queryRaw<
    Array<{ database: string }>
  >`SELECT current_database() AS database`;
  assert.equal(databaseIdentity[0]?.database, 'postgres');

  const requestedSlugs = runIds.flatMap((runId) => [
    `qa-workflows-${runId}-a`,
    `qa-workflows-${runId}-b`,
  ]);
  const organizations = await prisma.organization.findMany({
    where: { slug: { in: requestedSlugs } },
    select: { id: true, slug: true, legalName: true, status: true },
    orderBy: { slug: 'asc' },
  });
  const organizationIds = organizations.map(({ id }) => id);
  const sqlOrganizationIds = Prisma.join(organizationIds.map((id) => Prisma.sql`${id}::uuid`));
  const knownRunId = (slug: string) =>
    runIds.find(
      (runId) => slug === `qa-workflows-${runId}-a` || slug === `qa-workflows-${runId}-b`,
    );
  for (const organization of organizations) {
    const runId = knownRunId(organization.slug);
    assert.ok(runId, 'QA cleanup bloqueado: organização fora da allowlist de run IDs.');
    assert.equal(organization.status, 'ARCHIVED');
    assert.ok(organization.legalName.includes(runId));
  }

  const [members, users, organizationColumnRows, foreignKeyRows, foreignChildRows, storageObjects] =
    await Promise.all([
      prisma.organizationMember.findMany({
        where: { organizationId: { in: organizationIds } },
        select: { organizationId: true, profileId: true, userId: true, status: true },
      }),
      prisma.user.findMany({
        where: { organizationId: { in: organizationIds } },
        select: { organizationId: true, id: true, authUserId: true, email: true },
      }),
      prisma.$queryRaw<Array<{ tableName: string }>>`
        SELECT table_name AS "tableName"
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND column_name = 'organization_id'
         GROUP BY table_name
         ORDER BY table_name
      `,
      prisma.$queryRaw<ForeignKey[]>`
        SELECT child.relname AS "childTable", parent.relname AS "parentTable"
          FROM pg_constraint constraint_row
          JOIN pg_class child ON child.oid = constraint_row.conrelid
          JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
          JOIN pg_class parent ON parent.oid = constraint_row.confrelid
          JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
         WHERE constraint_row.contype = 'f'
           AND child_schema.nspname = 'public'
           AND parent_schema.nspname = 'public'
           AND child.relname = ANY(${[...organizationTables]}::text[])
           AND parent.relname = ANY(${[...organizationTables]}::text[])
      `,
      prisma.$queryRaw<Array<{ childTable: string; parentTable: string }>>`
        SELECT child.relname AS "childTable", parent.relname AS "parentTable"
          FROM pg_constraint constraint_row
          JOIN pg_class child ON child.oid = constraint_row.conrelid
          JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
          JOIN pg_class parent ON parent.oid = constraint_row.confrelid
          JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
         WHERE constraint_row.contype = 'f'
           AND child_schema.nspname = 'public'
           AND parent_schema.nspname = 'public'
           AND parent.relname = ANY(${[...organizationTables]}::text[])
           AND child.relname <> ALL(${[...organizationTables]}::text[])
      `,
      prisma.$queryRaw<StorageObject[]>`
        SELECT bucket_id AS bucket, name
          FROM storage.objects
         WHERE split_part(name, '/', 1) = 'organizations'
           AND split_part(name, '/', 2) = ANY(${organizationIds}::text[])
           AND bucket_id = ANY(${[...bucketNames]}::text[])
      `,
    ]);

  assert.deepEqual(
    organizationColumnRows
      .map(({ tableName }) => tableName)
      .filter((table) => organizationTables.includes(table as (typeof organizationTables)[number]))
      .length,
    organizationTables.length,
    'QA cleanup bloqueado: a allowlist não cobre todas as tabelas do schema esperado.',
  );
  const unknownOrganizationTables = organizationColumnRows
    .map(({ tableName }) => tableName)
    .filter((table) => !organizationTables.includes(table as (typeof organizationTables)[number]));
  assert.deepEqual(
    unknownOrganizationTables,
    [],
    'QA cleanup bloqueado: há tabelas tenant-scoped fora da allowlist estática.',
  );
  assert.deepEqual(
    foreignChildRows,
    [],
    'QA cleanup bloqueado: há tabela fora da allowlist com FK para dados que seriam removidos.',
  );
  assert.ok(
    members.every(({ status }) => status !== 'ACTIVE'),
    'QA cleanup bloqueado: há membership ativa em uma organização alvo.',
  );
  const targetProfileIds = [...new Set(members.map(({ profileId }) => profileId))];
  const outsideMemberships = targetProfileIds.length
    ? await prisma.organizationMember.findMany({
        where: { profileId: { in: targetProfileIds }, organizationId: { notIn: organizationIds } },
        select: { profileId: true },
      })
    : [];
  assert.equal(
    outsideMemberships.length,
    0,
    'QA cleanup bloqueado: uma identidade sintética também pertence a organização não alvo.',
  );

  for (const user of users) {
    const runId = knownRunId(organizations.find(({ id }) => id === user.organizationId)!.slug)!;
    assert.ok(user.authUserId, 'QA cleanup bloqueado: usuário de teste sem Auth ID rastreável.');
    assert.ok(
      user.email === `qa-invite-${runId}@example.test` ||
        (user.email.startsWith(`qa-${runId}-`) && user.email.endsWith('@example.test')),
      'QA cleanup bloqueado: e-mail fora do padrão sintético reservado.',
    );
  }

  const authList = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  assert.ifError(authList.error);
  const expectedAuth = new Map(users.map((user) => [user.authUserId!, user.email]));
  const targetAuthUsers = authList.data.users.filter((user) => {
    const email = user.email?.toLowerCase() ?? '';
    return runIds.some(
      (runId) =>
        email === `qa-invite-${runId}@example.test` ||
        (email.startsWith(`qa-${runId}-`) && email.endsWith('@example.test')),
    );
  });
  for (const user of targetAuthUsers) {
    assert.ok(user.banned_until, 'QA cleanup bloqueado: identidade QA não está desativada.');
    if (expectedAuth.has(user.id)) assert.equal(user.email, expectedAuth.get(user.id));
    else
      assert.ok(
        !members.some(({ profileId }) => profileId === user.id),
        'QA cleanup bloqueado: Auth identity não confirmada pelo registro sintético esperado.',
      );
  }
  assert.equal(
    targetAuthUsers.filter((user) => expectedAuth.has(user.id)).length,
    expectedAuth.size,
    'QA cleanup bloqueado: contas Auth e usuários públicos não correspondem exatamente.',
  );

  const counts: Record<string, number> = {};
  if (organizationIds.length) {
    for (const table of organizationTables) {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT count(*) AS count FROM ${Prisma.raw(`public."${table}"`)} WHERE organization_id IN (${sqlOrganizationIds})`,
      );
      counts[table] = Number(rows[0]?.count ?? 0n);
    }
  }
  const order = tableDeleteOrder(foreignKeyRows);
  const immutableEvidence: Array<{ table: string; count: number }> = immutableTables
    .filter((table) => (counts[table] ?? 0) > 0)
    .map((table) => ({ table, count: counts[table] }));
  const systemAccessEvents = organizationIds.length
    ? await prisma.activityEvent.count({
        where: { organizationId: { in: organizationIds }, type: 'SYSTEM_ACCESS' },
      })
    : 0;
  if (systemAccessEvents > 0)
    immutableEvidence.push({ table: 'activity_events:SYSTEM_ACCESS', count: systemAccessEvents });
  const confirmedPayments = organizationIds.length
    ? await prisma.payment.count({
        where: { organizationId: { in: organizationIds }, status: 'CONFIRMED' },
      })
    : 0;
  if (confirmedPayments > 0)
    immutableEvidence.push({ table: 'payments:CONFIRMED', count: confirmedPayments });

  const plan = {
    runIds,
    organizations: organizations.length,
    organizationsArchived: organizations.filter(({ status }) => status === 'ARCHIVED').length,
    membershipsSuspended: members.filter(({ status }) => status !== 'ACTIVE').length,
    tenantTablesWithRows: Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([table, count]) => ({ table, count })),
    syntheticAuthUsers: targetAuthUsers.length,
    syntheticAuthUsersDisabled: targetAuthUsers.filter((user) => Boolean(user.banned_until)).length,
    storageObjectsByBucket: bucketNames.map((bucket) => ({
      bucket,
      count: storageObjects.filter((object) => object.bucket === bucket).length,
    })),
    immutableEvidence,
    deletionOrderIfRetentionAllows: order,
    physicalCleanupStatus: immutableEvidence.length ? 'BLOCKED_RETENTION' : 'NOT_APPLIED',
    mode: 'READ_ONLY_RETENTION_AUDIT',
    artifactsRetainedLocally: true,
  };
  console.log(JSON.stringify(plan, null, 2));
  mkdirSync('test-results', { recursive: true });
  writeFileSync(`test-results/qa-cleanup-${Date.now()}.json`, JSON.stringify(plan, null, 2), {
    flag: 'wx',
  });
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Erro de limpeza QA não identificado.';
    console.error(`QA cleanup bloqueado/falhou: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
