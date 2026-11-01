-- Somente leitura. Executar manualmente no destino explicitamente confirmado.
-- Antes: 17 migrations e tabela de comprovantes ausente.
-- Depois: 19 migrations, comprovantes presente e zero grants proibidos.
-- Contagens são referências desta auditoria, não licença para ignorar divergências.
BEGIN READ ONLY;

SELECT current_database(), current_user, current_setting('server_version') AS postgres_version;
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
SELECT to_regclass('public.payment_receipts')::text AS payment_receipts;

SELECT dependency, to_regclass('public.' || dependency) IS NOT NULL AS present
FROM unnest(ARRAY['organizations','users','clients','documents','receivables',
  'receivable_installments','expenses','payments','permissions','roles','role_permissions']) dependency;

SELECT proname, pg_get_function_identity_arguments(oid) AS arguments
FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('enforce_same_organization','validate_payment_receipt_target');

SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
  pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname;

SELECT grantee, privilege_type, count(*) AS tables
FROM information_schema.table_privileges
WHERE table_schema='public' AND grantee IN ('anon','authenticated')
GROUP BY grantee, privilege_type ORDER BY grantee, privilege_type;

-- Privilégios efetivos incluem herança. Resultado esperado pós-migration: zero linhas.
SELECT c.relname, r.role_name, p.privilege
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN (VALUES ('anon'),('authenticated')) r(role_name)
CROSS JOIN (VALUES ('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
WHERE n.nspname='public' AND c.relkind='r'
  AND has_table_privilege(r.role_name, c.oid, p.privilege);

SELECT pg_get_userbyid(d.defaclrole) AS creator, n.nspname,
  d.defaclobjtype::text, d.defaclacl::text
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
WHERE n.nspname='public' OR d.defaclnamespace=0;

SELECT tgname, tgenabled::text FROM pg_trigger
WHERE tgrelid=to_regclass('public.payment_receipts') AND NOT tgisinternal ORDER BY tgname;
SELECT conname, contype::text, convalidated FROM pg_constraint
WHERE conrelid=to_regclass('public.payment_receipts') ORDER BY conname;

-- Sem texto de consultas, credenciais, identidades ou linhas de negócio.
SELECT mode, granted, count(*) AS locks FROM pg_locks GROUP BY mode, granted;
SELECT state, count(*) AS connections FROM pg_stat_activity GROUP BY state;
COMMIT;
