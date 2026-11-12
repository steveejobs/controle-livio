import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateIdentityEnvironment } from './identity-environment.mjs';

// Diagnostics only: EXPLAIN without ANALYZE never executes the described DML.
// No metadata mutations, migrations, role grants, policies or SECURITY DEFINER RPCs.
export function planDeniesEveryRow(value) {
  if (!value || typeof value !== 'object') return false;
  if (value['One-Time Filter'] === 'false' || value['One-Time Filter'] === false) return true;
  if (value.Filter === 'false' || value.Filter === false) return true;
  return (
    Array.isArray(value.Plans) && value.Plans.length > 0 && value.Plans.every(planDeniesEveryRow)
  );
}

export function restrictiveBucketBoundary(policies, role, operation) {
  const expected = "(bucket_id<>'legal-documents'::text)";
  const matches = (text) => text?.replace(/\s/g, '') === expected;
  return policies.some(
    (p) =>
      p.policyname === `document_api_${operation}_boundary` &&
      p.cmd === operation.toUpperCase() &&
      p.permissive === 'RESTRICTIVE' &&
      p.roles.replace(/[{}"]/g, '').split(',').includes(role) &&
      (operation === 'insert' ? matches(p.with_check) : matches(p.qual)) &&
      (operation !== 'update' || matches(p.with_check)),
  );
}

export function ordinaryStorageSession(session, identity) {
  return (
    session.role === (identity ? 'authenticated' : 'anon') &&
    session.profile_id === (identity?.profileId ?? null) &&
    !session.rolsuper &&
    !session.rolbypassrls &&
    !session.owns_table &&
    session.can_assume_privileged === false &&
    session.relrowsecurity === true
  );
}

export function sanitizeProviderPayload(value) {
  if (value instanceof Error)
    return sanitizeProviderPayload({
      name: value.name,
      message: value.message,
      code: value.code,
      statusCode: value.statusCode,
    });
  if (Array.isArray(value)) return value.map(sanitizeProviderPayload);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /token|authorization|apikey|secret|url/i.test(key)
          ? '[REDACTED]'
          : sanitizeProviderPayload(entry),
      ]),
    );
  if (typeof value !== 'string') return value;
  return value
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[JWT_REDACTED]')
    .replace(/https?:\/\/\S+/g, '[URL_REDACTED]')
    .replace(/postgres(?:ql)?:\/\/\S+/g, '[DATABASE_URL_REDACTED]')
    .slice(0, 2000);
}

export function diagnoseStorageAttempt(proof) {
  const result = (classification, securityProven = false) => ({ classification, securityProven });
  if (proof.unchanged === false) return result('UNAUTHORIZED_MUTATION');
  if (!proof.fixtureValid || !proof.serverExists || !proof.jwtValidated)
    return result('INVALID_FIXTURE');
  if (proof.unchanged !== true) return result('INCONCLUSIVE');
  if (proof.response.kind === 'AUTHORIZATION_DENIED')
    return result('AUTHORIZATION_DENIED_PROVEN', proof.positiveControl === true);
  // Ambiguous HTTP responses need independent, current role/SQL/provider proof.
  if (!proof.writeBarrier || !proof.positiveControl || !proof.providerIdentified)
    return result('INCONCLUSIVE');
  if (
    proof.operation === 'delete' &&
    proof.response.http === 200 &&
    Array.isArray(proof.response.providerBody) &&
    proof.response.providerBody.length === 0 &&
    proof.missingControl?.http === 200 &&
    Array.isArray(proof.missingControl.providerBody) &&
    proof.missingControl.providerBody.length === 0
  )
    return result('VALID_PROVIDER_NOOP', true);
  if (
    ['move', 'copy-new'].includes(proof.operation) &&
    proof.response.http === 400 &&
    proof.response.code === 'NoSuchKey' &&
    proof.missingControl?.code === 'NoSuchKey'
  ) {
    if (proof.sourceVisible === false) return result('OBJECT_NOT_VISIBLE_PROVEN', true);
    if (proof.operation === 'move' && proof.sourceVisible === true)
      return result('AUTHORIZATION_DENIED_PROVEN', true);
  }
  return result('INCONCLUSIVE');
}

export async function inspectStorageCatalog(env, db) {
  validateIdentityEnvironment(env, process.cwd());
  const image = JSON.parse(
    execFileSync(
      'docker',
      ['inspect', '--format', '{{json .Config.Image}}', 'supabase_storage_livio-legal-crm'],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
      },
    ),
  );
  const policies = await db.$queryRawUnsafe(
    "SELECT policyname,permissive,roles::text AS roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname",
  );
  const relation = await db.$queryRawUnsafe(
    "SELECT c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,c.relacl::text AS acl FROM pg_class c WHERE c.oid='storage.objects'::regclass",
  );
  const columns = await db.$queryRawUnsafe(
    "SELECT attname,attacl::text AS acl FROM pg_attribute WHERE attrelid='storage.objects'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum",
  );
  const roles = await db.$queryRawUnsafe(
    "SELECT rolname,rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','supabase_storage_admin','postgres') ORDER BY rolname",
  );
  const memberships = await db.$queryRawUnsafe(
    "SELECT pg_get_userbyid(member) AS member,pg_get_userbyid(roleid) AS role FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated'))",
  );
  const functions = await db.$queryRawUnsafe(
    "SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.provolatile::text AS volatility,p.proparallel::text AS parallel,p.proconfig,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('has_permission','current_client_id','current_organization_ids','can_download_storage_object','storage_object_organization_id') ORDER BY signature",
  );
  const sdk = JSON.parse(
    readFileSync(resolve('node_modules/@supabase/storage-js/package.json'), 'utf8'),
  ).version;
  const imageId = execFileSync(
    'docker',
    ['inspect', '--format', '{{.Image}}', 'supabase_storage_livio-legal-crm'],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 },
  ).trim();
  return { image, imageId, sdk, policies, relation, columns, roles, memberships, functions };
}

export async function inspectActorStorage(env, db, identity, bucket, key, catalog) {
  validateIdentityEnvironment(env, process.cwd());
  const role = identity ? 'authenticated' : 'anon';
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(identity ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon');
      await tx.$queryRawUnsafe(
        "SELECT set_config('request.jwt.claims',$1,true)",
        JSON.stringify({ role, ...(identity ? { sub: identity.profileId } : {}) }),
      );
      const [session] = await tx.$queryRawUnsafe(
        "SELECT current_user::text AS role,auth.uid()::text AS profile_id,r.rolsuper,r.rolbypassrls,(pg_has_role(current_user,c.relowner,'USAGE') OR pg_has_role(current_user,c.relowner,'SET')) AS owns_table,c.relrowsecurity,has_table_privilege(current_user,c.oid,'SELECT') AS can_select,has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,has_table_privilege(current_user,c.oid,'DELETE') AS can_delete,EXISTS (SELECT 1 FROM pg_roles privileged WHERE (privileged.rolsuper OR privileged.rolbypassrls) AND pg_has_role(current_user,privileged.oid,'SET')) AS can_assume_privileged FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname=current_user AND c.oid='storage.objects'::regclass",
      );
      const visible = await tx.$queryRawUnsafe(
        'SELECT id::text,name,bucket_id FROM storage.objects WHERE bucket_id=$1 AND name=$2',
        bucket,
        key,
      );
      // Evaluate only the exact, catalog-matched restrictive expression with the real
      // bucket value. Do not execute arbitrary policy text or pretend EXPLAIN executes DML.
      const [predicate] = await tx.$queryRawUnsafe(
        "SELECT ($1::text <> 'legal-documents'::text) AS allowed",
        bucket,
      );
      const plans = {};
      for (const [operation, query] of [
        [
          'delete',
          'EXPLAIN (FORMAT JSON, VERBOSE) DELETE FROM storage.objects WHERE bucket_id=$1 AND name=$2',
        ],
        [
          'update',
          'EXPLAIN (FORMAT JSON, VERBOSE) UPDATE storage.objects SET name=name WHERE bucket_id=$1 AND name=$2',
        ],
      ]) {
        const rows = await tx.$queryRawUnsafe(query, bucket, key);
        plans[operation] = rows[0]['QUERY PLAN'][0];
      }
      const permissions = identity
        ? await tx.$queryRawUnsafe(
            "SELECT public.has_permission($1::uuid,'documents','view') AS can_view,public.has_permission($1::uuid,'documents','create') AS can_create,public.has_permission($1::uuid,'documents','update') AS can_update,public.has_permission($1::uuid,'documents','delete') AS can_delete",
            identity.org,
          )
        : [];
      const ordinary = ordinaryStorageSession(session, identity);
      return {
        session,
        permissions,
        visible,
        plans,
        predicate,
        constantFalsePlanObserved: {
          delete: planDeniesEveryRow(plans.delete.Plan),
          update: planDeniesEveryRow(plans.update.Plan),
        },
        method:
          'Role-bound SELECT; EXPLAIN without ANALYZE; exact restrictive catalog predicate evaluated for the bucket. No direct metadata DML executed.',
        barriers: {
          delete:
            ordinary &&
            restrictiveBucketBoundary(catalog.policies, role, 'delete') &&
            predicate.allowed === false,
          move:
            ordinary &&
            restrictiveBucketBoundary(catalog.policies, role, 'update') &&
            predicate.allowed === false,
          'copy-new':
            ordinary &&
            restrictiveBucketBoundary(catalog.policies, role, 'insert') &&
            predicate.allowed === false,
        },
      };
    },
    { timeout: 30000 },
  );
}
