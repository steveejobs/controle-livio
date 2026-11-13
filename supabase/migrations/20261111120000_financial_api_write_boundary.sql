BEGIN;
-- Preserve SELECT/RLS, server privileges, Auth lifecycle and integrity triggers.
-- Financial evidence in Storage gains a write-only guard below.
DO $security$
DECLARE t text; c record; r text;
BEGIN
 FOREACH t IN ARRAY ARRAY['contracts','receivables','receivable_installments','payments','payment_allocations','payment_reversals','payment_change_requests','financial_adjustments','renegotiations','expenses','payment_receipts','audit_logs',
 -- Dependencies: admin-only identity/configuration and financial document evidence.
 'organizations','users','roles','permissions','role_permissions','user_roles',
 'organization_members','organization_member_roles','documents','document_versions'] LOOP
  IF to_regclass('public.' || t) IS NULL THEN RAISE EXCEPTION 'Missing relation: %', t; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relkind='r' AND relrowsecurity AND relforcerowsecurity) THEN
   RAISE EXCEPTION 'Expected ordinary FORCE RLS table: %',t;
  END IF;
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM PUBLIC, anon, authenticated', t);
  FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=to_regclass('public.' || t) AND attnum>0 AND NOT attisdropped LOOP
   EXECUTE format('REVOKE INSERT (%I), UPDATE (%I) ON public.%I FROM PUBLIC, anon, authenticated', c.attname,c.attname,t);
  END LOOP;
  EXECUTE format('CREATE POLICY financial_api_insert ON public.%I AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false)',t);
  EXECUTE format('CREATE POLICY financial_api_update ON public.%I AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false)',t);
  EXECUTE format('CREATE POLICY financial_api_delete ON public.%I AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false)',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE (rolsuper OR rolbypassrls) AND pg_has_role(r,oid,'SET')) THEN RAISE EXCEPTION 'Unsafe client role: %',r; END IF;
   IF has_table_privilege(r,'public.'||t,'INSERT,UPDATE,DELETE') OR has_any_column_privilege(r,'public.'||t,'INSERT,UPDATE') THEN
    RAISE EXCEPTION 'Inherited write privilege: % on %; inspect memberships',r,t;
   END IF;
  END LOOP;
 END LOOP;
END;
$security$;
-- RI cascades can modify financial children without a direct child DML grant.
-- Client/matter edits remain available; identity and tenant are never editable.
CREATE FUNCTION public.protect_financial_parent_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $identity$
BEGIN
 IF (NEW.id,NEW.organization_id) IS DISTINCT FROM (OLD.id,OLD.organization_id) THEN
  RAISE EXCEPTION 'Financial parent identity and organization are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$identity$;
REVOKE ALL ON FUNCTION public.protect_financial_parent_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_financial_client_identity BEFORE UPDATE OF id,organization_id ON public.clients
 FOR EACH ROW EXECUTE FUNCTION public.protect_financial_parent_identity();
CREATE TRIGGER protect_financial_matter_identity BEFORE UPDATE OF id,organization_id ON public.matters
 FOR EACH ROW EXECUTE FUNCTION public.protect_financial_parent_identity();
-- Read-only helper: RLS on receipts must not hide evidence linkage from this guard.
CREATE FUNCTION public.is_financial_storage_object(object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $evidence$
 SELECT EXISTS (
  SELECT 1 FROM public.document_versions v JOIN public.documents d ON d.id=v.document_id
  WHERE v.storage_key=object_name AND (
   d.installment_id IS NOT NULL OR d.payment_id IS NOT NULL OR d.expense_id IS NOT NULL
   OR d.contract_id IS NOT NULL
   OR EXISTS (SELECT 1 FROM public.payment_receipts r WHERE r.document_id=d.id)
  )
 )
$evidence$;
REVOKE ALL ON FUNCTION public.is_financial_storage_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_financial_storage_object(text) TO authenticated;
CREATE POLICY financial_evidence_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (bucket_id <> 'legal-documents' OR NOT public.is_financial_storage_object(name))
 WITH CHECK (bucket_id <> 'legal-documents' OR NOT public.is_financial_storage_object(name));
CREATE POLICY financial_evidence_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING (bucket_id <> 'legal-documents' OR NOT public.is_financial_storage_object(name));
COMMIT;
