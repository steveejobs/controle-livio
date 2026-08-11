BEGIN;

ALTER TABLE public.users ADD COLUMN auth_user_id uuid;
ALTER TABLE public.users ADD CONSTRAINT users_auth_user_id_key UNIQUE (auth_user_id);
ALTER TABLE public.users ADD CONSTRAINT users_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.current_organization_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT organization_id FROM public.users
  WHERE auth_user_id = auth.uid() AND status = 'ACTIVE' AND deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.current_organization_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_organization_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_permission(target_organization_id uuid, target_resource text, target_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.user_roles ur ON ur.organization_id = u.organization_id AND ur.user_id = u.id
    JOIN public.role_permissions rp ON rp.organization_id = ur.organization_id AND rp.role_id = ur.role_id
    JOIN public.permissions p ON p.organization_id = rp.organization_id AND p.id = rp.permission_id
    WHERE u.auth_user_id = auth.uid() AND u.organization_id = target_organization_id
      AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      AND p.resource = target_resource AND p.action = target_action
  )
$$;
REVOKE ALL ON FUNCTION public.has_permission(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text, text) TO authenticated;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_select ON public.organizations FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_organization_ids()));
CREATE POLICY organizations_update ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_permission(id, 'organization', 'update'))
  WITH CHECK (public.has_permission(id, 'organization', 'update'));

DO $$
DECLARE relation record;
BEGIN
  FOR relation IN SELECT * FROM (VALUES
    ('users','users'), ('roles','roles'), ('permissions','roles'),
    ('user_roles','roles'), ('role_permissions','roles'), ('sessions','users'),
    ('password_reset_tokens','users'), ('clients','clients'), ('client_contacts','clients'),
    ('pipelines','pipelines'), ('pipeline_stages','pipelines'), ('matters','matters'),
    ('matter_parties','matters'), ('matter_stage_history','matters'), ('contracts','contracts'),
    ('receivables','receivables'), ('receivable_installments','receivables'),
    ('payments','payments'), ('payment_reversals','payments'), ('payment_allocations','payments'),
    ('financial_adjustments','receivables'), ('renegotiations','receivables'),
    ('expenses','expenses'), ('documents','documents'), ('document_versions','documents'),
    ('internal_notes','notes'), ('client_messages','messages'), ('tasks','tasks'),
    ('task_comments','tasks'), ('task_reminders','tasks'), ('task_history','tasks'),
    ('calendar_events','calendar'), ('notifications','notifications'), ('audit_logs','audit'),
    ('activity_events','audit')
  ) AS policy_relation(table_name, resource_name)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation.table_name);
    EXECUTE format('CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated USING (public.has_permission(organization_id, %L, %L))', relation.table_name, relation.resource_name, 'view');
    EXECUTE format('CREATE POLICY tenant_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_permission(organization_id, %L, %L))', relation.table_name, relation.resource_name, 'create');
    IF relation.table_name NOT IN ('matter_stage_history', 'payment_reversals', 'payment_allocations', 'document_versions', 'task_history', 'audit_logs', 'activity_events') THEN
      EXECUTE format('CREATE POLICY tenant_update ON public.%I FOR UPDATE TO authenticated USING (public.has_permission(organization_id, %L, %L)) WITH CHECK (public.has_permission(organization_id, %L, %L))', relation.table_name, relation.resource_name, 'update', relation.resource_name, 'update');
      EXECUTE format('CREATE POLICY tenant_delete ON public.%I FOR DELETE TO authenticated USING (public.has_permission(organization_id, %L, %L))', relation.table_name, relation.resource_name, 'delete');
    END IF;
  END LOOP;
END;
$$;

CREATE POLICY users_read_own_profile ON public.users FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public)
VALUES ('legal-documents', 'legal-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY legal_documents_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'legal-documents' AND (storage.foldername(name))[1]::uuid IN (SELECT public.current_organization_ids()) AND public.has_permission((storage.foldername(name))[1]::uuid, 'documents', 'view'));
CREATE POLICY legal_documents_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'legal-documents' AND (storage.foldername(name))[1]::uuid IN (SELECT public.current_organization_ids()) AND public.has_permission((storage.foldername(name))[1]::uuid, 'documents', 'create'));
CREATE POLICY legal_documents_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'legal-documents' AND public.has_permission((storage.foldername(name))[1]::uuid, 'documents', 'update'))
  WITH CHECK (bucket_id = 'legal-documents' AND public.has_permission((storage.foldername(name))[1]::uuid, 'documents', 'update'));
CREATE POLICY legal_documents_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'legal-documents' AND public.has_permission((storage.foldername(name))[1]::uuid, 'documents', 'delete'));

COMMIT;
