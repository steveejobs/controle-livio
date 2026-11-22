-- Read-only preflight AND postcheck. Capture before/after in disposable CI.
SELECT current_user, session_user, version();
SELECT rolname, rolsuper, rolbypassrls, rolinherit FROM pg_roles;
SELECT * FROM pg_auth_members;
SELECT * FROM information_schema.table_privileges WHERE table_schema='public';
SELECT * FROM information_schema.column_privileges WHERE table_schema='public';
SELECT * FROM pg_default_acl;
SELECT * FROM pg_policies WHERE schemaname IN ('public','storage');
SELECT n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';
SELECT * FROM pg_views WHERE schemaname='public';
SELECT p.oid::regprocedure,p.prosecdef,p.proacl,p.proconfig,pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f';
SELECT tgrelid::regclass,tgname,tgenabled,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal;
SELECT conrelid::regclass,conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace;

-- Explicit PUBLIC ACLs (grantee zero), column ACLs, and SET ROLE paths.
SELECT c.oid::regclass::text AS relation,a.grantee,a.privilege_type,a.is_grantable
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
WHERE n.nspname='public';
SELECT attrelid::regclass::text,attname,attacl::text FROM pg_attribute
WHERE attacl IS NOT NULL AND attrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace);
SELECT c.rolname AS client,p.rolname AS reachable_bypass FROM pg_roles c CROSS JOIN pg_roles p
WHERE c.rolname IN ('anon','authenticated') AND (p.rolsuper OR p.rolbypassrls) AND pg_has_role(c.oid,p.oid,'SET');
