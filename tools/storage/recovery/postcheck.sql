-- Read-only catalog proof; never substitutes for provider execution or crash tests.
SELECT current_user, current_database();
SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname LIKE 'storage_recovery_%'
UNION ALL SELECT c.relname,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_class c WHERE c.oid='public.storage_upload_intents'::regclass;
SELECT p.proname,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.provolatile,p.proparallel,p.proconfig,p.proacl,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS browser_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'storage_recovery_%';
SELECT tgrelid::regclass,tgname,tgenabled,tgfoid::regprocedure,pg_get_triggerdef(oid)
FROM pg_trigger WHERE NOT tgisinternal AND (tgname LIKE 'recovery_%' OR tgname LIKE 'storage_recovery_%');
SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
WHERE (schemaname='storage' AND tablename='objects') OR tablename IN
 ('storage_upload_intents','storage_recovery_events','storage_recovery_incidents','storage_recovery_configuration');
SELECT job_name,last_scheduled_at,last_completed_at,last_failed_at FROM public.scheduled_job_state WHERE job_name='storage_recovery';
SELECT column_name,data_type,is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='storage_upload_intents'
AND column_name IN ('abandoned_at','cleanup_started_at','owner_token','lease_until','generation');
