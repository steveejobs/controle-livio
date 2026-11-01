import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Configure ${name} para inspeção somente leitura.`);
  return value;
};

const projectRef = required('SUPABASE_PROJECT_REF');
assert.equal(projectRef, required('CONFIRM_SUPABASE_PROJECT_REF'));
const supabaseUrl = new URL(required('SUPABASE_URL'));
const databaseUrl = new URL(required('DATABASE_URL'));
const directUrl = new URL(required('DIRECT_URL'));
assert.equal(supabaseUrl.hostname, `${projectRef}.supabase.co`);
const databaseMatchesProject = (url: URL) =>
  url.hostname === `db.${projectRef}.supabase.co` ||
  (url.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(url.username).includes(projectRef));
assert.ok(databaseMatchesProject(databaseUrl));
assert.ok(databaseMatchesProject(directUrl));

const prisma = new PrismaClient();
const supabase = createClient(supabaseUrl.origin, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const reservedTestDomain = (email: string | undefined) => {
  const domain = email?.toLowerCase().split('@').at(-1) ?? '';
  return (
    domain === 'example.com' ||
    domain === 'example.org' ||
    domain === 'example.net' ||
    domain === 'example.test' ||
    domain === 'example.invalid' ||
    domain === 'localhost' ||
    domain === 'test' ||
    domain.endsWith('.test') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.example')
  );
};

async function inspect() {
  const connection = await prisma.$queryRaw<
    Array<{ database: string; databaseRole: string; serverAddress: string | null }>
  >`
    SELECT current_database() AS database,
           current_user AS "databaseRole",
           inet_server_addr()::text AS "serverAddress"
  `;
  const runtimeDbIdentityMatches =
    databaseMatchesProject(databaseUrl) &&
    (decodeURIComponent(databaseUrl.username).includes(projectRef) ||
      connection[0]?.databaseRole.includes(projectRef) ||
      databaseUrl.hostname === `db.${projectRef}.supabase.co`);

  const organizations = await prisma.$queryRaw<
    Array<{ scope: string; status: string; count: number }>
  >`
    SELECT CASE
             WHEN slug ILIKE 'qa-workflows-%' OR slug ~* '^(qa|test)[-_]'
               THEN 'qa_prefix'
             ELSE 'other_or_unclassified'
           END AS scope,
           status::text AS status,
           count(*)::integer AS count
      FROM public.organizations
     GROUP BY 1, 2
     ORDER BY 1, 2
  `;
  const organizationIds = await prisma.$queryRaw<Array<{ id: string; isQa: boolean }>>`
    SELECT id::text AS id,
           (slug ILIKE 'qa-workflows-%' OR slug ~* '^(qa|test)[-_]') AS "isQa"
      FROM public.organizations
  `;

  const entityCounts = await prisma.$queryRaw<
    Array<{ entity: string; scope: string; count: number }>
  >`
    WITH orgs AS (
      SELECT id,
             CASE
               WHEN slug ILIKE 'qa-workflows-%' OR slug ~* '^(qa|test)[-_]'
                 THEN 'qa_prefix'
               ELSE 'other_or_unclassified'
             END AS scope
        FROM public.organizations
    ), records AS (
      SELECT 'organization_members'::text AS entity, o.scope, m.id
        FROM public.organization_members m JOIN orgs o ON o.id = m.organization_id
      UNION ALL SELECT 'clients', o.scope, c.id FROM public.clients c JOIN orgs o ON o.id = c.organization_id
      UNION ALL SELECT 'client_contacts', o.scope, c.id FROM public.client_contacts c JOIN orgs o ON o.id = c.organization_id
      UNION ALL SELECT 'pipelines', o.scope, p.id FROM public.pipelines p JOIN orgs o ON o.id = p.organization_id
      UNION ALL SELECT 'matters', o.scope, m.id FROM public.matters m JOIN orgs o ON o.id = m.organization_id
      UNION ALL SELECT 'contracts', o.scope, c.id FROM public.contracts c JOIN orgs o ON o.id = c.organization_id
      UNION ALL SELECT 'receivables', o.scope, r.id FROM public.receivables r JOIN orgs o ON o.id = r.organization_id
      UNION ALL SELECT 'payments', o.scope, p.id FROM public.payments p JOIN orgs o ON o.id = p.organization_id
      UNION ALL SELECT 'receivable_installments', o.scope, i.id FROM public.receivable_installments i JOIN orgs o ON o.id = i.organization_id
      UNION ALL SELECT 'payment_allocations', o.scope, a.id FROM public.payment_allocations a JOIN orgs o ON o.id = a.organization_id
      UNION ALL SELECT 'expenses', o.scope, e.id FROM public.expenses e JOIN orgs o ON o.id = e.organization_id
      UNION ALL SELECT 'documents', o.scope, d.id FROM public.documents d JOIN orgs o ON o.id = d.organization_id
      UNION ALL SELECT 'document_versions', o.scope, v.id FROM public.document_versions v JOIN orgs o ON o.id = v.organization_id
      UNION ALL SELECT 'document_signing_requests', o.scope, s.id FROM public.document_signing_requests s JOIN orgs o ON o.id = s.organization_id
      UNION ALL SELECT 'tasks', o.scope, t.id FROM public.tasks t JOIN orgs o ON o.id = t.organization_id
      UNION ALL SELECT 'calendar_events', o.scope, e.id FROM public.calendar_events e JOIN orgs o ON o.id = e.organization_id
      UNION ALL SELECT 'notifications', o.scope, n.id FROM public.notifications n JOIN orgs o ON o.id = n.organization_id
      UNION ALL SELECT 'client_messages', o.scope, m.id FROM public.client_messages m JOIN orgs o ON o.id = m.organization_id
      UNION ALL SELECT 'internal_notes', o.scope, n.id FROM public.internal_notes n JOIN orgs o ON o.id = n.organization_id
      UNION ALL SELECT 'matter_stage_history', o.scope, h.id FROM public.matter_stage_history h JOIN orgs o ON o.id = h.organization_id
      UNION ALL SELECT 'web_push_subscriptions', o.scope, s.id FROM public.web_push_subscriptions s JOIN orgs o ON o.id = s.organization_id
      UNION ALL SELECT 'audit_logs', o.scope, a.id FROM public.audit_logs a JOIN orgs o ON o.id = a.organization_id
      UNION ALL SELECT 'activity_events', o.scope, e.id FROM public.activity_events e JOIN orgs o ON o.id = e.organization_id
    )
    SELECT entity, scope, count(*)::integer AS count
      FROM records
     GROUP BY entity, scope
     ORDER BY entity, scope
  `;

  const notificationSummary = await prisma.$queryRaw<
    Array<{
      scope: string;
      channel: string;
      status: string;
      count: number;
      overduePending: number;
      dueWithinHour: number;
    }>
  >`
    SELECT CASE
             WHEN o.slug ILIKE 'qa-workflows-%' OR o.slug ~* '^(qa|test)[-_]'
               THEN 'qa_prefix'
             ELSE 'other_or_unclassified'
           END AS scope,
           n.channel::text AS channel,
           n.status::text AS status,
           count(*)::integer AS count,
           count(*) FILTER (
             WHERE n.status::text = 'PENDING' AND n.scheduled_at <= now()
           )::integer AS "overduePending",
           count(*) FILTER (
             WHERE n.status::text = 'PENDING'
               AND n.scheduled_at > now()
               AND n.scheduled_at <= now() + interval '1 hour'
           )::integer AS "dueWithinHour"
      FROM public.notifications n
      JOIN public.organizations o ON o.id = n.organization_id
     GROUP BY 1, 2, 3
     ORDER BY 1, 2, 3
  `;

  const storage = await prisma.$queryRaw<
    Array<{ bucket: string; objectCount: number; qaPrefixObjectCount: number }>
  >`
    WITH qa_orgs AS (
      SELECT id::text AS id
        FROM public.organizations
       WHERE slug ILIKE 'qa-workflows-%' OR slug ~* '^(qa|test)[-_]'
    )
    SELECT b.id AS bucket,
           count(o.id)::integer AS "objectCount",
           count(o.id) FILTER (
             WHERE split_part(o.name, '/', 1) IN (SELECT id FROM qa_orgs)
           )::integer AS "qaPrefixObjectCount"
      FROM storage.buckets b
      LEFT JOIN storage.objects o ON o.bucket_id = b.id
     GROUP BY b.id
     ORDER BY b.id
  `;

  let schedulerVault:
    | {
        available: true;
        schedulerSecretExists: boolean;
        schedulerUrlExists: boolean;
        schedulerPointsToKnownProduction: boolean;
        schedulerUrlIsHttps: boolean;
      }
    | { available: false; errorType: string };
  try {
    const [secrets] = await prisma.$queryRaw<
      Array<{
        schedulerSecretExists: boolean;
        schedulerUrlExists: boolean;
        schedulerPointsToKnownProduction: boolean;
        schedulerUrlIsHttps: boolean;
      }>
    >`
      SELECT coalesce(bool_or(name = 'livio_notifications_cron_secret'), false)
               AS "schedulerSecretExists",
             coalesce(bool_or(name = 'livio_notifications_api_url'), false)
               AS "schedulerUrlExists",
             coalesce(bool_or(
               name = 'livio_notifications_api_url'
               AND decrypted_secret ~* '^https://(controle-livio\.vercel\.app|controle-livio-web\.vercel\.app)(/|$)'
             ), false) AS "schedulerPointsToKnownProduction",
             coalesce(bool_or(
               name = 'livio_notifications_api_url'
               AND decrypted_secret ~* '^https://'
             ), false) AS "schedulerUrlIsHttps"
        FROM vault.decrypted_secrets
       WHERE name IN ('livio_notifications_cron_secret', 'livio_notifications_api_url')
    `;
    schedulerVault = secrets
      ? { available: true, ...secrets }
      : { available: false, errorType: 'EmptyResult' };
  } catch (error) {
    schedulerVault = {
      available: false,
      errorType: error instanceof Error ? error.name : 'Error',
    };
  }

  const authSettingsResponse = await fetch(`${supabaseUrl.origin}/auth/v1/settings`, {
    headers: { apikey: required('SUPABASE_ANON_KEY') },
    signal: AbortSignal.timeout(15_000),
  });
  const authSettings = (await authSettingsResponse.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const authUsers = {
    available: false,
    total: 0,
    reservedSyntheticEmailDomain: 0,
    otherPotentiallyDeliverableDomain: 0,
    noEmail: 0,
    banned: 0,
  };
  let page = 1;
  let authUserQueryError = false;
  while (true) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) {
      authUserQueryError = true;
      break;
    }
    authUsers.available = true;
    for (const user of result.data.users) {
      authUsers.total += 1;
      if (!user.email) authUsers.noEmail += 1;
      else if (reservedTestDomain(user.email)) authUsers.reservedSyntheticEmailDomain += 1;
      else authUsers.otherPotentiallyDeliverableDomain += 1;
      if (user.banned_until) authUsers.banned += 1;
    }
    if (result.data.users.length < 1000) break;
    page += 1;
  }

  const result = {
    mode: 'READ_ONLY_INVENTORY',
    projectRef,
    destinations: {
      authHost: supabaseUrl.hostname,
      storageHost: supabaseUrl.hostname,
      databaseHost: databaseUrl.hostname,
      directDatabaseHost: directUrl.hostname,
      databaseName: connection[0]?.database ?? null,
      databaseProjectIdentityMatches: runtimeDbIdentityMatches,
      directDatabaseProjectIdentityMatches: databaseMatchesProject(directUrl),
    },
    organizations,
    entityCounts,
    auth: {
      settingsHttpStatus: authSettingsResponse.status,
      publicSignupDisabled:
        typeof authSettings.disable_signup === 'boolean' ? authSettings.disable_signup : null,
      emailAutoconfirm:
        typeof authSettings.mailer_autoconfirm === 'boolean'
          ? authSettings.mailer_autoconfirm
          : null,
      smsAutoconfirm:
        typeof authSettings.sms_autoconfirm === 'boolean' ? authSettings.sms_autoconfirm : null,
      users: authUserQueryError ? { ...authUsers, available: false } : authUsers,
    },
    storage,
    notifications: notificationSummary,
    schedulerVault,
    countsOnly: true,
    identifiersOrPersonalContentEmitted: false,
  };
  return { result, qaOrganizationCount: organizationIds.filter(({ isQa }) => isQa).length };
}

async function main() {
  try {
    const { result, qaOrganizationCount } = await inspect();
    const report = { ...result, qaPrefixOrganizations: qaOrganizationCount };
    const outputPath = `test-results/qa-current-target-readonly-${Date.now()}.json`;
    mkdirSync('test-results', { recursive: true });
    writeFileSync(outputPath, JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ ...report, artifact: outputPath }, null, 2));
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'Error';
    console.error(
      `Inspeção somente leitura falhou (${errorName}); nenhum valor sensível foi impresso.`,
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
