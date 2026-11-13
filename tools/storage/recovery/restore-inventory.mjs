import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const recoveryRestoreInventory = JSON.parse(
  readFileSync(new URL('./restore-inventory.json', import.meta.url), 'utf8'),
);
export const recoveryPrivateTableQuery = `
SELECT coalesce(json_agg(t ORDER BY t.name),'[]')::text FROM (
 SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS "forceRls",pg_get_userbyid(c.relowner) AS owner,
 NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner) AS "ownerOnlyAcl",
 NOT EXISTS (SELECT 1 FROM pg_attribute col CROSS JOIN LATERAL aclexplode(CASE WHEN cardinality(col.attacl)>0 THEN col.attacl END) a WHERE col.attrelid=c.oid AND a.grantee<>c.relowner) AS "ownerOnlyColumnAcl",
 NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(name) WHERE has_table_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(r.name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) AS "noBrowserPrivileges",
 (has_table_privilege('postgres',c.oid,'SELECT') AND has_table_privilege('postgres',c.oid,'INSERT') AND has_table_privilege('postgres',c.oid,'UPDATE') AND has_table_privilege('postgres',c.oid,'DELETE')) AS "serverAccess"
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('storage_upload_intents','storage_recovery_events','storage_recovery_incidents','storage_recovery_configuration') AND c.relkind='r'
) t`;
export const recoveryFunctionQuery = `
SELECT coalesce(json_agg(f ORDER BY f.name),'[]')::text FROM (
 SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS name,pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS "securityDefiner",p.proconfig AS config,p.proacl::text AS acl,
 NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(name) WHERE has_function_privilege(r.name,p.oid,'EXECUTE')) AS "noBrowserExecute",
 has_function_privilege('postgres',p.oid,'EXECUTE') AS "serverExecute"
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'storage_recovery_%'
) f`;
export function assertRecoveryArchive(entries, privacy, functions) {
  const tables = recoveryRestoreInventory.aclNames
    .filter((n) => n.startsWith('TABLE '))
    .map((n) => n.slice(6))
    .sort();
  assert.ok(Array.isArray(privacy), 'Actual source private-table catalog proof is required');
  assert.deepEqual(privacy.map((r) => r.name).sort(), tables);
  for (const row of privacy) {
    assert.equal(row.rls, true);
    assert.equal(row.forceRls, true);
    assert.equal(row.ownerOnlyColumnAcl, true);
    assert.equal(row.serverAccess, true);
    assert.equal(row.ownerOnlyAcl, true);
    assert.equal(row.noBrowserPrivileges, true);
    assert.ok(['postgres', 'supabase_admin'].includes(row.owner));
  }
  assert.ok(Array.isArray(functions), 'Actual function EXECUTE/owner catalog required');
  assert.deepEqual(
    functions.map((f) => 'FUNCTION ' + f.name).sort(),
    recoveryRestoreInventory.aclNames.filter((n) => n.startsWith('FUNCTION ')),
  );
  for (const fn of functions) {
    assert.equal(fn.securityDefiner, true);
    assert.deepEqual(fn.config, ['search_path=pg_catalog']);
    assert.equal(fn.noBrowserExecute, true);
    assert.equal(fn.serverExecute, true);
    assert.ok(['postgres', 'supabase_admin'].includes(fn.owner));
  }
  const names = entries
    .filter(
      (entry) =>
        entry?.description === 'ACL' &&
        entry.namespace === 'public' &&
        /^(TABLE storage_(?:recovery_|upload_intents)|FUNCTION storage_recovery_)/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    names.filter((name) => name.startsWith('FUNCTION ')),
    recoveryRestoreInventory.aclNames.filter((name) => name.startsWith('FUNCTION ')),
    'Recovery ACL entries must match the reviewed object names exactly',
  );
  assert.equal(new Set(names).size, names.length, 'Duplicate ACL identities');
  assert.ok(
    names.every((name) => recoveryRestoreInventory.aclNames.includes(name)),
    'Unexpected recovery ACL',
  );
  // Owner-only table ACLs may be omitted by pg_dump. Actual catalog proof is
  // mandatory; source/target owner, grant and RLS comparisons remain unchanged.
  return names.length;
}
export function assertRecoveryOwners(records) {
  const names = records
    .map((entry) => entry.slice(0, entry.lastIndexOf(':')))
    .filter((name) =>
      /^(RELATION:public\.storage_(?:recovery_|upload_intents)|TYPE:public\._?storage_(?:recovery_|upload_intents)|ROUTINE:public\.storage_recovery_)/.test(
        name,
      ),
    )
    .sort();
  assert.deepEqual(
    names,
    recoveryRestoreInventory.owners,
    'Recovery owner inventory differs from the reviewed objects',
  );
}
