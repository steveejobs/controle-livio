import assert from 'node:assert/strict';
import { financialTables } from './financial-write-matrix.mjs';

export const dependencyTables = [
  'organizations',
  'users',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'organization_members',
  'organization_member_roles',
  'documents',
  'document_versions',
];

export async function inspectFinancialSecurity(database, record = () => {}) {
  const role = await database.$queryRawUnsafe(
    `SELECT current_user::text AS name, current_setting('server_version_num') AS version, r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE rolname=current_user`,
  );
  assert.equal(
    Math.floor(Number(role[0].version) / 10000),
    17,
    'Expected disposable PostgreSQL 17',
  );
  assert.ok(
    role[0].rolsuper || role[0].rolbypassrls,
    'API role must keep its existing FORCE RLS contract',
  );
  const result = { role, tables: [] };
  for (const table of [...financialTables, ...dependencyTables]) {
    const [relation] = await database.$queryRawUnsafe(
      `SELECT c.relowner::regrole::text AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text FROM pg_class c WHERE c.oid=to_regclass($1)`,
      `public.${table}`,
    );
    assert.ok(relation?.relrowsecurity && relation.relforcerowsecurity, table);
    const [apiAcl] = await database.$queryRawUnsafe(
      `SELECT has_table_privilege(current_user,$1,'SELECT') AS read,has_table_privilege(current_user,$1,'INSERT') AS insert,has_table_privilege(current_user,$1,'UPDATE') AS update,has_table_privilege(current_user,$1,'DELETE') AS delete`,
      `public.${table}`,
    );
    assert.ok(
      Object.values(apiAcl).every(Boolean),
      `API role lacks a required table privilege: ${table}`,
    );
    const acl = await database.$queryRawUnsafe(
      `SELECT r.rolname,has_table_privilege(r.oid,$1,'SELECT') AS read,has_table_privilege(r.oid,$1,'INSERT,UPDATE,DELETE') AS write,has_any_column_privilege(r.oid,$1,'INSERT,UPDATE') AS column_write FROM pg_roles r WHERE r.rolname IN ('anon','authenticated')`,
      `public.${table}`,
    );
    assert.equal(acl.length, 2);
    assert.ok(
      acl.every((r) => !r.write && !r.column_write),
      `Remaining inherited/column DML: ${table}`,
    );
    const policies = await database.$queryRawUnsafe(
      `SELECT policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=$1`,
      table,
    );
    for (const cmd of ['INSERT', 'UPDATE', 'DELETE'])
      assert.ok(
        policies.some(
          (p) =>
            p.cmd === cmd &&
            p.permissive === 'RESTRICTIVE' &&
            p.policyname.startsWith('financial_api_'),
        ),
        `${table}: ${cmd}`,
      );
    assert.ok(!policies.some((p) => p.cmd === 'ALL' && p.policyname.startsWith('financial_api_')));
    const triggers = await database.$queryRawUnsafe(
      `SELECT tgname,tgenabled,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid=to_regclass($1) AND NOT tgisinternal`,
      `public.${table}`,
    );
    assert.ok(
      triggers.every((t) => t.tgenabled !== 'D'),
      'Integrity trigger disabled',
    );
    const constraints = await database.$queryRawUnsafe(
      `SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=to_regclass($1)`,
      `public.${table}`,
    );
    result.tables.push({ table, ...relation, apiAcl, acl, policies, triggers, constraints });
    record(result);
  }
  result.escalation = await database.$queryRawUnsafe(
    `SELECT c.rolname AS client,p.rolname AS privileged FROM pg_roles c CROSS JOIN pg_roles p WHERE c.rolname IN ('anon','authenticated') AND (p.rolsuper OR p.rolbypassrls) AND pg_has_role(c.oid,p.oid,'SET')`,
  );
  assert.equal(result.escalation.length, 0, 'Client can SET ROLE to a privileged identity');
  result.parentGuards = await database.$queryRawUnsafe(
    `SELECT tgrelid::regclass::text AS relation,tgname,tgenabled,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgname IN ('protect_financial_client_identity','protect_financial_matter_identity')`,
  );
  assert.equal(result.parentGuards.length, 2);
  assert.ok(result.parentGuards.every((t) => t.tgenabled !== 'D'));
  result.storagePolicies = await database.$queryRawUnsafe(
    `SELECT policyname,permissive,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN ('financial_evidence_update','financial_evidence_delete')`,
  );
  assert.equal(result.storagePolicies.length, 2);
  assert.ok(
    result.storagePolicies.every(
      (p) => p.permissive === 'RESTRICTIVE' && ['UPDATE', 'DELETE'].includes(p.cmd),
    ),
  );
  const [helperOwner] = await database.$queryRawUnsafe(
    `SELECT r.rolname,r.rolsuper,r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='public.is_financial_storage_object(text)'::regprocedure`,
  );
  assert.ok(
    helperOwner.rolsuper || helperOwner.rolbypassrls,
    'Storage linkage helper must see FORCE RLS evidence',
  );
  result.helperOwner = helperOwner;
  result.memberships = await database.$queryRawUnsafe(
    `SELECT roleid::regrole::text AS parent,member::regrole::text AS member,inherit_option,set_option FROM pg_auth_members`,
  );
  result.defaults = await database.$queryRawUnsafe(
    `SELECT defaclrole::regrole::text AS owner,defaclnamespace::regnamespace::text AS schema,defaclobjtype,defaclacl::text FROM pg_default_acl`,
  );
  result.views = await database.$queryRawUnsafe(
    `SELECT c.relname,c.relkind,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) ELSE NULL END AS definition FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('v','m','f')`,
  );
  result.functions = await database.$queryRawUnsafe(
    `SELECT p.proname,pg_get_functiondef(p.oid) AS definition,p.proconfig::text,p.proowner::regrole::text AS owner,p.prosecdef,p.prorettype::regtype::text AS returns,p.proacl::text,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.proname`,
  );
  const allowedDefiners = [
    'handle_auth_user_profile',
    'current_organization_ids',
    'has_permission',
    'current_client_id',
    'can_access_client_resource',
    'can_download_storage_object',
    'is_financial_storage_object',
  ];
  assert.ok(
    result.functions
      .filter((f) => f.prosecdef && f.authenticated_execute && f.returns !== 'trigger')
      .every((f) => allowedDefiners.includes(f.proname)),
    'Unreviewed executable SECURITY DEFINER',
  );
  assert.equal(result.views.length, 0, 'New public view requires explicit write-path review');
  record(result);
  return result;
}
