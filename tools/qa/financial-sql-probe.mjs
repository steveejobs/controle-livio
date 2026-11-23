// Optional local SQL grammar/ACL probe. No server, filesystem database or network.
// Supply the absolute path to a separately installed @electric-sql/pglite module.
// This does NOT replace PostgreSQL/Supabase/Auth/PostgREST integration.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { financialTables } from './financial-write-matrix.mjs';
import { dependencyTables } from './financial-security-ci.mjs';

assert.ok(
  process.argv[2] && isAbsolute(process.argv[2]),
  'Pass an absolute local PGlite module path',
);
const { PGlite } = createRequire(import.meta.url)(process.argv[2]);
const sql = readFileSync(
  new URL(
    '../../supabase/migrations/20261111120000_financial_api_write_boundary.sql',
    import.meta.url,
  ),
  'utf8',
);
const tables = [...financialTables, ...dependencyTables];
const evidence = {
  scope: 'in-memory PostgreSQL engine; synthetic minimal schema, no Supabase or integration',
  cases: [],
};
for (const scenario of ['normal', 'inherited-grant', 'missing-table', 'reachable-bypass']) {
  const db = new PGlite();
  try {
    await db.exec(
      `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA storage; CREATE TABLE storage.objects(bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; CREATE POLICY test_select ON storage.objects FOR SELECT TO authenticated USING(true); CREATE POLICY test_update ON storage.objects FOR UPDATE TO authenticated USING(true) WITH CHECK(true); CREATE POLICY test_delete ON storage.objects FOR DELETE TO authenticated USING(true); GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,UPDATE,DELETE ON storage.objects TO authenticated;`,
    );
    const version = (await db.query('SHOW server_version_num')).rows[0].server_version_num;
    assert.equal(Math.floor(Number(version) / 10000), 17);
    for (const table of tables) {
      if (scenario === 'missing-table' && table === 'expenses') continue;
      const extra =
        table === 'documents'
          ? ', installment_id text,payment_id text,expense_id text,contract_id text'
          : table === 'document_versions'
            ? ', document_id text,storage_key text'
            : table === 'payment_receipts'
              ? ', document_id text'
              : '';
      await db.exec(
        `CREATE TABLE public.${table}(id text PRIMARY KEY,organization_id text${extra}); ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY; CREATE POLICY test_select ON public.${table} FOR SELECT TO authenticated USING(true); GRANT SELECT,INSERT,UPDATE,DELETE ON public.${table} TO PUBLIC,anon,authenticated,service_role;`,
      );
    }
    await db.exec(
      `INSERT INTO contracts VALUES ('contract','org'); GRANT UPDATE (organization_id) ON contracts TO authenticated;`,
    );
    await db.exec(
      "CREATE TABLE public.clients(id text PRIMARY KEY,organization_id text); CREATE TABLE public.matters(id text PRIMARY KEY,organization_id text); INSERT INTO clients VALUES ('client','org'); GRANT SELECT,UPDATE ON clients,matters TO authenticated;",
    );
    const before = (
      await db.query(
        `SELECT policyname,cmd,qual FROM pg_policies WHERE schemaname='public' AND cmd='SELECT' ORDER BY tablename`,
      )
    ).rows;
    if (scenario === 'inherited-grant')
      await db.exec(
        'CREATE ROLE extra_writer; GRANT UPDATE ON contracts TO extra_writer; GRANT extra_writer TO authenticated;',
      );
    if (scenario === 'reachable-bypass') await db.exec('GRANT service_role TO authenticated;');
    if (scenario !== 'normal') {
      await assert.rejects(db.exec(sql), (e) =>
        e.message.includes(
          scenario === 'missing-table'
            ? 'Missing relation'
            : scenario === 'reachable-bypass'
              ? 'Unsafe client role'
              : 'Inherited write privilege',
        ),
      );
      await db.exec('ROLLBACK');
      assert.equal(
        (
          await db.query(
            `SELECT count(*)::int AS n FROM pg_policies WHERE policyname LIKE 'financial_%'`,
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            `SELECT has_table_privilege('authenticated','contracts','UPDATE') AS permitted`,
          )
        ).rows[0].permitted,
        true,
      );
    } else {
      await db.exec(sql);
      await assert.rejects(
        db.exec("UPDATE clients SET organization_id='other' WHERE id='client'"),
        (e) => e.code === '23514',
      );
      await db.exec("UPDATE clients SET id=id WHERE id='client'");
      const after = (
        await db.query(
          `SELECT policyname,cmd,qual FROM pg_policies WHERE schemaname='public' AND cmd='SELECT' ORDER BY tablename`,
        )
      ).rows;
      assert.deepEqual(after, before);
      for (const table of tables) {
        const acl = (
          await db.query(
            `SELECT has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') AS write,has_any_column_privilege('authenticated',$1,'INSERT,UPDATE') AS column_write,has_table_privilege('service_role',$1,'INSERT') AS server_insert,has_table_privilege('service_role',$1,'UPDATE') AS server_update,has_table_privilege('service_role',$1,'DELETE') AS server_delete`,
            [table],
          )
        ).rows[0];
        assert.deepEqual(acl, {
          write: false,
          column_write: false,
          server_insert: true,
          server_update: true,
          server_delete: true,
        });
      }
      await db.exec(
        `INSERT INTO documents(id,organization_id,installment_id) VALUES('doc','org','installment'); INSERT INTO document_versions(id,document_id,storage_key) VALUES('version','doc','financial.pdf'); INSERT INTO storage.objects VALUES('legal-documents','financial.pdf'),('legal-documents','ordinary.pdf'); SET ROLE authenticated;`,
      );
      assert.equal((await db.query('SELECT * FROM contracts')).rows.length, 1);
      await assert.rejects(
        db.exec("UPDATE clients SET id='replacement' WHERE id='client'"),
        (e) => e.code === '23514',
      );
      await assert.rejects(
        db.exec(`UPDATE contracts SET organization_id='bad' WHERE id='contract'`),
        (e) => e.code === '42501',
      );
      assert.equal(
        (await db.query(`SELECT public.is_financial_storage_object('financial.pdf') AS protected`))
          .rows[0].protected,
        true,
      );
      await db.exec(
        `UPDATE storage.objects SET bucket_id='changed' WHERE name='financial.pdf'; DELETE FROM storage.objects WHERE name='financial.pdf';`,
      );
      assert.equal(
        (await db.query(`SELECT * FROM storage.objects WHERE name='financial.pdf'`)).rows[0]
          .bucket_id,
        'legal-documents',
      );
      await db.exec(`DELETE FROM storage.objects WHERE name='ordinary.pdf';`);
      assert.equal(
        (await db.query(`SELECT * FROM storage.objects WHERE name='ordinary.pdf'`)).rows.length,
        0,
      );
    }
    evidence.cases.push({ scenario, version, status: 'PASS' });
  } finally {
    await db.close();
  }
}
console.log(JSON.stringify(evidence, null, 2));
