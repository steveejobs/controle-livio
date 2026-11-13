// Optional PostgreSQL 17 in-memory rehearsal. NO server, URL, filesystem DB,
// Supabase or provider proof. Explicit external PGlite module path required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
assert.ok(process.argv[2] && isAbsolute(process.argv[2]));
const foundation = readFileSync(
  new URL('../../../supabase/migrations/20260807134500_initial_foundation.sql', import.meta.url),
  'utf8',
);
const actualTable = (name) => {
  const ddl = foundation.match(new RegExp('CREATE TABLE "' + name + '" \\([\\s\\S]*?\\n\\);'));
  assert.ok(ddl, 'Missing foundation table ' + name);
  return ddl[0];
};
const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20261113100000_persistent_storage_recovery.sql',
    import.meta.url,
  ),
  'utf8',
);
const permissionBlock = (source) =>
  source.slice(
    source.lastIndexOf('INSERT INTO public.permissions('),
    source.lastIndexOf('INSERT INTO public.role_permissions('),
  );
async function noInventedDefaults() {
  const rows = (
    await db.query(
      "SELECT table_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('permissions','audit_logs') AND column_name='id' ORDER BY table_name",
    )
  ).rows;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.is_nullable, 'NO');
    assert.equal(row.column_default, null, 'Do not invent UUID SQL defaults');
  }
}
const { PGlite } = createRequire(import.meta.url)(process.argv[2]);
const db = new PGlite(),
  checks = [];
const org = '10000000-0000-4000-8000-000000000001',
  user = 'a1000000-0000-4000-8000-000000000001';
const op = 'b1000000-0000-4000-8000-000000000001',
  resource = 'c1000000-0000-4000-8000-000000000001',
  key = `organizations/${org}/documents/${resource}/test.pdf`,
  hash = 'a'.repeat(64);
async function check(name, fn) {
  await fn();
  checks.push({ name, result: 'PASS' });
}
try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA storage;CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(current_setting('test.jwt_role',true),'service_role')$$;
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb,last_accessed_at timestamptz);
    CREATE TABLE public.organizations(id uuid PRIMARY KEY);
    CREATE TABLE public.users(id uuid PRIMARY KEY,organization_id uuid);
    CREATE TABLE public.document_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,document_id uuid,storage_key text,sha256 text);
    CREATE TABLE public.clients(id uuid PRIMARY KEY,organization_id uuid,photo_storage_key text);
    CREATE TABLE public.document_signing_requests(id uuid PRIMARY KEY,organization_id uuid,signature_storage_key text,signature_sha256 text);
    CREATE TABLE public.notifications(id uuid PRIMARY KEY,organization_id uuid);
    CREATE TABLE public.roles(id uuid PRIMARY KEY,organization_id uuid,key text,is_system boolean);
    CREATE TABLE public.role_permissions(organization_id uuid,role_id uuid,permission_id uuid,UNIQUE(organization_id,role_id,permission_id));
    INSERT INTO organizations VALUES('${org}');INSERT INTO users VALUES('${user}','${org}');`);
  await db.exec(foundation.match(/CREATE TYPE "AuditAction" AS ENUM [^;]+;/)[0]);
  await db.exec(actualTable('permissions'));
  await db.exec(actualTable('audit_logs'));
  for (const ddl of foundation.match(/CREATE (?:UNIQUE )?INDEX [^;]+;/g) ?? [])
    if (/ ON "(?:permissions|audit_logs)"\(/.test(ddl)) await db.exec(ddl);
  for (const ddl of foundation.match(
    /ALTER TABLE "(?:permissions|audit_logs)" ADD CONSTRAINT [^;]+;/g,
  ) ?? [])
    await db.exec(ddl);
  await check('actual foundation DDL requires UUID ids without SQL defaults', noInventedDefaults);
  await check(
    'invented UUID defaults are detected and rolled back in the test database',
    async () => {
      for (const table of ['permissions', 'audit_logs']) {
        await db.exec(
          'BEGIN; ALTER TABLE ' + table + ' ALTER COLUMN id SET DEFAULT gen_random_uuid();',
        );
        try {
          await assert.rejects(noInventedDefaults);
        } finally {
          await db.exec('ROLLBACK');
        }
      }
      await noInventedDefaults();
    },
  );
  await check(
    'native pg_catalog UUID generator is present and returns distinct UUIDs',
    async () => {
      const r = (await db.query('SELECT gen_random_uuid()::text AS id FROM generate_series(1,16)'))
        .rows;
      assert.equal(new Set(r.map((x) => x.id)).size, 16);
      assert.ok(
        r.every((x) =>
          /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x.id),
        ),
      );
      assert.ok(
        (
          await db.query(
            "SELECT to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL AS present",
          )
        ).rows[0].present,
      );
    },
  );
  await check(
    'three published pre-fix SQL inserts reproduce 23502 with the original DDL',
    async () => {
      for (const sql of [
        "INSERT INTO permissions(organization_id,resource,action) VALUES('" +
          org +
          "','storage_recovery','view')",
        "INSERT INTO permissions(organization_id,resource,action,description) VALUES('" +
          org +
          "','storage_recovery','manage','synthetic seed regression')",
        "INSERT INTO audit_logs(organization_id,action,resource) VALUES('" +
          org +
          "','UPDATE','storage_recovery')",
      ])
        await assert.rejects(
          db.exec(sql),
          (error) => error.code === '23502' && error.column === 'id',
        );
    },
  );
  await check('expansion executes on minimal PostgreSQL schema', () =>
    db.exec(
      readFileSync(
        new URL(
          '../../../supabase/migrations/20261113100000_persistent_storage_recovery.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  );
  await check('browser roles have no table access or privileged function execute', async () => {
    const r = await db.query(
      `SELECT has_table_privilege('authenticated','storage_upload_intents','SELECT') AS table_access,has_function_privilege('anon','storage_recovery_object_fence()','EXECUTE') AS execute`,
    );
    assert.deepEqual(r.rows, [{ table_access: false, execute: false }]);
  });
  await check('intent insert creates event and audit before external effect', async () => {
    await db.exec(`INSERT INTO storage_upload_intents(id,organization_id,purpose,bucket,object_key,resource_type,resource_id,expected_sha256,idempotency_key,owner_token,lease_until,due_at,actor_user_id)
      VALUES('${op}','${org}','DOCUMENT','legal-documents','${key}','document','${resource}','${hash}','test',gen_random_uuid(),now()+interval '1 hour',now(),'${user}');`);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM storage_recovery_events')).rows[0].n,
      1,
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n, 1);
  });
  await check('immutable identity, illegal transition and foreign owner are rejected', async () => {
    await assert.rejects(
      db.exec(`UPDATE storage_upload_intents SET object_key=object_key||'x' WHERE id='${op}'`),
    );
    await assert.rejects(
      db.exec(`UPDATE storage_upload_intents SET state='COMPLETE' WHERE id='${op}'`),
    );
    await assert.rejects(
      db.exec(`UPDATE storage_upload_intents SET actor_user_id=gen_random_uuid() WHERE id='${op}'`),
    );
  });
  await check('managed metadata admission requires live upload state and server role', async () => {
    await assert.rejects(
      db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('legal-documents','${key}')`),
    );
    await db.exec(`UPDATE storage_upload_intents SET state='UPLOADING' WHERE id='${op}'`);
    await db.exec(`SET test.jwt_role='authenticated'`);
    await assert.rejects(
      db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('legal-documents','${key}')`),
    );
    await db.exec(
      `SET test.jwt_role='service_role';INSERT INTO storage.objects(bucket_id,name) VALUES('legal-documents','${key}')`,
    );
  });
  await check('object attachment requires exact organization resource and hash', async () => {
    await db.exec(
      `UPDATE storage_upload_intents SET state='OBJECT_CREATED',observed_sha256=expected_sha256 WHERE id='${op}'`,
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO document_versions(organization_id,document_id,storage_key,sha256) VALUES(gen_random_uuid(),'${resource}','${key}','${hash}')`,
      ),
    );
    await assert.rejects(
      db.exec(
        `INSERT INTO document_versions(organization_id,document_id,storage_key,sha256) VALUES('${org}','${resource}','${key}','${'b'.repeat(64)}')`,
      ),
    );
    await db.exec(
      `INSERT INTO document_versions(organization_id,document_id,storage_key,sha256) VALUES('${org}','${resource}','${key}','${hash}')`,
    );
    await db.exec(
      `UPDATE storage_upload_intents SET state='ATTACHED' WHERE id='${op}';UPDATE storage_upload_intents SET state='COMPLETE' WHERE id='${op}'`,
    );
  });
  await check('historical reference prevents even privileged managed removal', async () => {
    await db.exec(
      `UPDATE storage_upload_intents SET state='RECONCILE_PENDING',cleanup_started_at=now() WHERE id='${op}';UPDATE storage_upload_intents SET state='DELETING' WHERE id='${op}'`,
    );
    await assert.rejects(db.exec(`DELETE FROM storage.objects WHERE name='${key}'`));
    await assert.rejects(
      db.exec(
        `INSERT INTO document_versions(organization_id,document_id,storage_key,sha256) VALUES('${org}','${resource}','${key}','${hash}')`,
      ),
    );
  });
  await check('legal hold and burned identity cannot be erased', async () => {
    await assert.rejects(
      db.exec(`UPDATE storage_upload_intents SET legal_hold=true WHERE id='${op}'`),
    );
    await db.exec(
      `UPDATE storage_upload_intents SET state='INCIDENT' WHERE id='${op}'; UPDATE storage_upload_intents SET legal_hold=true WHERE id='${op}'`,
    );
    await assert.rejects(
      db.exec(`UPDATE storage_upload_intents SET legal_hold=false WHERE id='${op}'`),
    );
    await assert.rejects(
      db.exec(`UPDATE storage_upload_intents SET cleanup_started_at=NULL WHERE id='${op}'`),
    );
  });
  await check('history is append only', async () => {
    await assert.rejects(db.exec(`DELETE FROM storage_upload_intents WHERE id='${op}'`));
    await assert.rejects(db.exec('UPDATE storage_recovery_events SET reason=reason'));
  });
  await check('security definers have pinned search path and no browser execute', async () => {
    const r = await db.query(
      `SELECT proname,prosecdef,proconfig,has_function_privilege('authenticated',oid,'EXECUTE') AS browser_execute FROM pg_proc WHERE proname LIKE 'storage_recovery_%'`,
    );
    assert.equal(r.rows.length, 6);
    for (const f of r.rows) {
      assert.equal(f.prosecdef, true);
      assert.deepEqual(f.proconfig, ['search_path=pg_catalog']);
      assert.equal(f.browser_execute, false);
    }
  });
  await check(
    'attempt resets require an unbound non-retained incident and identified decision',
    async () => {
      await db.exec(
        `UPDATE storage_upload_intents SET attempts=8,state='INCIDENT' WHERE id='${op}'`,
      );
      await assert.rejects(
        db.exec(`UPDATE storage_upload_intents SET attempts=0 WHERE id='${op}'`),
      );
      await assert.rejects(
        db.exec(
          `UPDATE storage_upload_intents SET attempts=0,generation=1,state='RECONCILE_PENDING',last_error_code='MANUAL_RETRY_AUTHORIZED' WHERE id='${op}'`,
        ),
      );
      const id = 'b1000000-0000-4000-8000-000000000002';
      await db.exec(`INSERT INTO storage_upload_intents(id,organization_id,purpose,bucket,object_key,resource_type,resource_id,expected_sha256,idempotency_key,owner_token,lease_until,due_at)
      VALUES('${id}','${org}','DOCUMENT','legal-documents','organizations/${org}/documents/manual/synthetic.pdf','document','${resource}','${hash}','manual',gen_random_uuid(),now(),now());
      UPDATE storage_upload_intents SET state='COMPENSATION_REQUIRED',attempts=8,cleanup_started_at=now() WHERE id='${id}';
      UPDATE storage_upload_intents SET state='INCIDENT' WHERE id='${id}';
      SET livio.recovery_actor='${user}';
      UPDATE storage_upload_intents SET state='RECONCILE_PENDING',attempts=0,generation=1,last_error_code='MANUAL_RETRY_AUTHORIZED' WHERE id='${id}';`);
      assert.equal(
        (await db.query(`SELECT generation FROM storage_upload_intents WHERE id='${id}'`)).rows[0]
          .generation,
        1,
      );
    },
  );
  await check(
    'abandoned upload accepts late indexing but permanently fences attachment',
    async () => {
      const late = 'b1000000-0000-4000-8000-000000000007',
        lateKey = `organizations/${org}/documents/late/synthetic.pdf`;
      await db.exec(`SET test.jwt_role='service_role';
      INSERT INTO storage_upload_intents(id,organization_id,purpose,bucket,object_key,resource_type,resource_id,expected_sha256,idempotency_key,owner_token,lease_until,due_at)
      VALUES('${late}','${org}','DOCUMENT','legal-documents','${lateKey}','document','${resource}','${hash}','late',gen_random_uuid(),now()+interval '1 hour',now());
      UPDATE storage_upload_intents SET state='UPLOADING' WHERE id='${late}';
      UPDATE storage_upload_intents SET abandoned_at=now(),last_error_code='PROVIDER_TIMEOUT' WHERE id='${late}';
      INSERT INTO storage.objects(bucket_id,name) VALUES('legal-documents','${lateKey}');`);
      assert.equal(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM storage_recovery_events WHERE operation_id='${late}' AND reason='UPLOAD_ABANDONED'`,
          )
        ).rows[0].n,
        1,
      );
      await assert.rejects(
        db.exec(`UPDATE storage_upload_intents SET abandoned_at=NULL WHERE id='${late}'`),
      );
      await db.exec(
        `UPDATE storage_upload_intents SET state='OBJECT_CREATED',observed_sha256='${hash}' WHERE id='${late}'`,
      );
      await assert.rejects(
        db.exec(
          `INSERT INTO document_versions(organization_id,document_id,storage_key,sha256) VALUES('${org}','${resource}','${lateKey}','${hash}')`,
        ),
      );
    },
  );
  await check(
    'retention cannot race committed deletion and burned keys reject late inserts',
    async () => {
      const late = 'b1000000-0000-4000-8000-000000000007';
      await db.exec(
        `UPDATE storage_upload_intents SET state='COMPENSATION_REQUIRED',cleanup_started_at=now() WHERE id='${late}'; UPDATE storage_upload_intents SET state='DELETING',attempts=1 WHERE id='${late}';`,
      );
      await assert.rejects(
        db.exec(`UPDATE storage_upload_intents SET legal_hold=true WHERE id='${late}'`),
      );
      await assert.rejects(
        db.exec(
          `INSERT INTO storage.objects(bucket_id,name) VALUES('legal-documents','organizations/${org}/documents/late/synthetic.pdf')`,
        ),
      );
    },
  );
  await check(
    'permission migration and seed blocks are idempotent and keep existing UUIDs',
    async () => {
      const seed = readFileSync(new URL('../../../supabase/seed.sql', import.meta.url), 'utf8');
      const query =
        "SELECT id::text,organization_id::text,resource,action FROM permissions WHERE resource='storage_recovery' ORDER BY action";
      const before = (await db.query(query)).rows;
      assert.equal(before.length, 2);
      for (let i = 0; i < 2; i++) {
        await db.exec(permissionBlock(migration));
        await db.exec(permissionBlock(seed));
      }
      assert.deepEqual((await db.query(query)).rows, before);
      assert.equal(new Set(before.map((x) => x.id)).size, 2);
      await assert.rejects(
        db.exec(
          'INSERT INTO permissions(id,organization_id,resource,action) SELECT gen_random_uuid(),organization_id,resource,action FROM permissions LIMIT 1',
        ),
        (error) => error.code === '23505',
      );
      await assert.rejects(
        db.exec(
          "INSERT INTO permissions(id,organization_id,resource,action) SELECT id,organization_id,resource||'_different',action FROM permissions LIMIT 1",
        ),
        (error) => error.code === '23505',
      );
    },
  );
  await check(
    'transition audit UUIDs are distinct and actor organization event semantics survive',
    async () => {
      const auditOp = 'b1000000-0000-4000-8000-000000000063';
      await db.exec(
        "SET livio.recovery_actor='" +
          user +
          "'; INSERT INTO storage_upload_intents(id,organization_id,purpose,bucket,object_key,resource_type,resource_id,expected_sha256,idempotency_key,owner_token,lease_until,due_at) VALUES('" +
          auditOp +
          "','" +
          org +
          "','DOCUMENT','legal-documents','organizations/" +
          org +
          "/documents/audit/synthetic.pdf','document','" +
          resource +
          "','" +
          hash +
          "','audit-real-ddl',gen_random_uuid(),now()+interval '1 hour',now()); UPDATE storage_upload_intents SET state='UPLOADING' WHERE id='" +
          auditOp +
          "';",
      );
      const rows = (
        await db.query(
          'SELECT id::text,organization_id::text,actor_user_id::text,action::text,resource,resource_id::text,"after" FROM audit_logs WHERE resource_id=$1::uuid ORDER BY created_at,id',
          [auditOp],
        )
      ).rows;
      assert.equal(rows.length, 2);
      assert.equal(new Set(rows.map((r) => r.id)).size, 2);
      assert.ok(
        rows.every(
          (r) =>
            r.organization_id === org &&
            r.actor_user_id === user &&
            r.action === 'UPDATE' &&
            r.resource === 'storage_recovery',
        ),
      );
      assert.deepEqual(rows.map((r) => r.after.state).sort(), ['PLANNED', 'UPLOADING']);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM storage_recovery_events WHERE operation_id='" +
              auditOp +
              "' AND actor_user_id='" +
              user +
              "'",
          )
        ).rows[0].n,
        2,
      );
    },
  );
  await noInventedDefaults();
  const ownerObjects = (
    await db.query(`SELECT 'RELATION:public.'||relname AS object FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'storage_%' AND relkind IN ('r','i')
    UNION ALL SELECT 'TYPE:public.'||typname FROM pg_type WHERE typnamespace='public'::regnamespace AND (typname LIKE 'storage_%' OR typname LIKE '_storage_%')
    UNION ALL SELECT 'ROUTINE:public.'||oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'storage_recovery_%' ORDER BY object`)
  ).rows.map((row) => row.object);
  console.log(
    JSON.stringify({
      environment: 'PGlite PostgreSQL 17, minimal schema, NO provider/concurrency/crash proof',
      checks,
      ownerObjects,
    }),
  );
} finally {
  await db.close();
}
