-- Read-only preflight/postcheck. Run only in the explicitly identified disposable DB.
SELECT current_user, current_database(), version();
SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;
SELECT relnamespace::regnamespace::text AS schema, relname, relowner::regrole::text AS owner,
       relrowsecurity, relforcerowsecurity, relacl FROM pg_class
 WHERE oid IN ('storage.objects'::regclass, 'storage.buckets'::regclass);
SELECT * FROM pg_policies WHERE schemaname='storage' ORDER BY tablename,policyname;
SELECT rolname, rolsuper, rolinherit, rolbypassrls FROM pg_roles
 WHERE rolname IN ('anon','authenticated','service_role','authenticator','supabase_storage_admin','postgres');
SELECT member::regrole::text AS member, roleid::regrole::text AS inherited_role
 FROM pg_auth_members ORDER BY 1,2;
SELECT * FROM information_schema.role_table_grants WHERE table_schema='storage';
SELECT * FROM information_schema.column_privileges WHERE table_schema='storage';
SELECT defaclrole::regrole::text, defaclnamespace::regnamespace::text, defaclobjtype, defaclacl
 FROM pg_default_acl WHERE defaclnamespace IN ('storage'::regnamespace,'public'::regnamespace);
SELECT n.nspname,p.proname,p.prosecdef,p.proowner::regrole::text,p.proacl
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','storage') ORDER BY 1,2;
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;
