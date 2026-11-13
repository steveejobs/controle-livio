-- Read only. Execute before reviewing local expansion; never prints connection data.
SELECT current_user,current_database(),version();
SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('postgres','anon','authenticated','service_role','supabase_storage_admin');
SELECT member_role.rolname AS member,granted_role.rolname AS granted_role
FROM pg_auth_members membership JOIN pg_roles member_role ON member_role.oid=membership.member
JOIN pg_roles granted_role ON granted_role.oid=membership.roleid;
SELECT to_regclass('public.storage_upload_intents') AS conflicting_intents,
 to_regclass('public.storage_recovery_incidents') AS conflicting_incidents,
 to_regclass('public.document_versions') AS document_baseline,
 to_regclass('storage.objects') AS storage_baseline;
SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='document_signing_requests';
