BEGIN;

-- Supabase Auth is the identity source. These tables separate a global profile
-- from organization-scoped memberships while keeping public.users as the
-- operational user referenced by the existing domain foreign keys.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email varchar(320) NOT NULL,
  full_name text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT,
  status public."UserStatus" NOT NULL DEFAULT 'INVITED',
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (organization_id, profile_id),
  UNIQUE (user_id)
);

CREATE INDEX organization_members_profile_status_idx
  ON public.organization_members(profile_id, status);
CREATE INDEX organization_members_organization_status_idx
  ON public.organization_members(organization_id, status);
CREATE INDEX organization_members_organization_client_idx
  ON public.organization_members(organization_id, client_id);

CREATE TABLE public.organization_member_roles (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL REFERENCES public.organization_members(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  assigned_at timestamptz(3) NOT NULL DEFAULT now(),
  assigned_by_membership_id uuid REFERENCES public.organization_members(id) ON DELETE RESTRICT,
  PRIMARY KEY (organization_id, membership_id, role_id)
);

CREATE INDEX organization_member_roles_role_idx
  ON public.organization_member_roles(organization_id, role_id);

-- Multi-organization users need one operational public.users row per membership.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_auth_user_id_key;
CREATE INDEX users_auth_user_id_idx ON public.users(auth_user_id);
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

INSERT INTO public.profiles (id, email, full_name, created_at, updated_at)
SELECT DISTINCT ON (u.auth_user_id)
  u.auth_user_id, u.email, u.full_name, u.created_at, u.updated_at
FROM public.users u
WHERE u.auth_user_id IS NOT NULL
ORDER BY u.auth_user_id, u.created_at
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members
  (organization_id, profile_id, user_id, client_id, status, created_at, updated_at)
SELECT u.organization_id, u.auth_user_id, u.id, u.client_id, u.status, u.created_at, u.updated_at
FROM public.users u
WHERE u.auth_user_id IS NOT NULL
ON CONFLICT (organization_id, profile_id) DO NOTHING;

INSERT INTO public.organization_member_roles
  (organization_id, membership_id, role_id, assigned_at)
SELECT ur.organization_id, om.id, ur.role_id, ur.assigned_at
FROM public.user_roles ur
JOIN public.organization_members om
  ON om.organization_id = ur.organization_id AND om.user_id = ur.user_id
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE status = 'ACTIVE' AND deleted_at IS NULL AND auth_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Auth migration blocked: active public.users rows must be provisioned in Supabase Auth first';
  END IF;
END;
$$;

-- The legacy verifier is removed from the application in the same release.
-- Once every active account has an auth_user_id, custom password hashes must not remain.
UPDATE public.users SET password_hash = NULL WHERE password_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_auth_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(COALESCE(NEW.email, ''), '@', 1), 'Usuario')
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_user_profile_sync ON auth.users;
CREATE TRIGGER auth_user_profile_sync
  AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_profile();

CREATE OR REPLACE FUNCTION public.current_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT om.organization_id
  FROM public.organization_members om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.profile_id = auth.uid() AND om.status = 'ACTIVE' AND o.status = 'ACTIVE'
$$;

CREATE OR REPLACE FUNCTION public.has_permission(
  target_organization_id uuid,
  target_resource text,
  target_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.organization_member_roles omr
      ON omr.organization_id = om.organization_id AND omr.membership_id = om.id
    JOIN public.role_permissions rp
      ON rp.organization_id = omr.organization_id AND rp.role_id = omr.role_id
    JOIN public.permissions p
      ON p.organization_id = rp.organization_id AND p.id = rp.permission_id
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.profile_id = auth.uid()
      AND om.organization_id = target_organization_id
      AND om.status = 'ACTIVE'
      AND o.status = 'ACTIVE'
      AND p.resource = target_resource
      AND p.action = target_action
  )
$$;

CREATE OR REPLACE FUNCTION public.current_client_id(target_organization_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT om.client_id
  FROM public.organization_members om
  WHERE om.profile_id = auth.uid()
    AND om.organization_id = target_organization_id
    AND om.status = 'ACTIVE'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_access_client_resource(
  target_organization_id uuid,
  target_client_id uuid,
  target_resource text,
  target_action text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.has_permission(target_organization_id, target_resource, target_action)
    AND (
      public.current_client_id(target_organization_id) IS NULL
      OR public.current_client_id(target_organization_id) = target_client_id
    )
$$;

REVOKE ALL ON FUNCTION public.current_organization_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_permission(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_client_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_client_resource(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_organization_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_client_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_client_resource(uuid, uuid, text, text) TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_member_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY memberships_select ON public.organization_members FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.has_permission(organization_id, 'users', 'view')
  );
CREATE POLICY memberships_insert ON public.organization_members FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(organization_id, 'users', 'manage'));
CREATE POLICY memberships_update ON public.organization_members FOR UPDATE TO authenticated
  USING (public.has_permission(organization_id, 'users', 'manage'))
  WITH CHECK (public.has_permission(organization_id, 'users', 'manage'));

CREATE POLICY membership_roles_select ON public.organization_member_roles FOR SELECT TO authenticated
  USING (
    membership_id IN (
      SELECT id FROM public.organization_members WHERE profile_id = auth.uid()
    )
    OR public.has_permission(organization_id, 'roles', 'view')
  );
CREATE POLICY membership_roles_insert ON public.organization_member_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(organization_id, 'roles', 'manage'));
CREATE POLICY membership_roles_delete ON public.organization_member_roles FOR DELETE TO authenticated
  USING (public.has_permission(organization_id, 'roles', 'manage'));

-- Client members may only read records tied to their own client id.
DROP POLICY IF EXISTS tenant_select ON public.matters;
CREATE POLICY tenant_select ON public.matters FOR SELECT TO authenticated
  USING (public.can_access_client_resource(organization_id, client_id, 'matters', 'view'));

DROP POLICY IF EXISTS tenant_select ON public.matter_parties;
CREATE POLICY tenant_select ON public.matter_parties FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'matters', 'view')
    AND (
      public.current_client_id(organization_id) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.matters m
        WHERE m.id = matter_parties.matter_id AND m.organization_id = matter_parties.organization_id
          AND m.client_id = public.current_client_id(matter_parties.organization_id)
      )
    )
  );

DROP POLICY IF EXISTS tenant_select ON public.matter_stage_history;
CREATE POLICY tenant_select ON public.matter_stage_history FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'matters', 'view')
    AND (
      public.current_client_id(organization_id) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.matters m
        WHERE m.id = matter_stage_history.matter_id AND m.organization_id = matter_stage_history.organization_id
          AND m.client_id = public.current_client_id(matter_stage_history.organization_id)
      )
    )
  );

DROP POLICY IF EXISTS tenant_select ON public.contracts;
CREATE POLICY tenant_select ON public.contracts FOR SELECT TO authenticated
  USING (public.can_access_client_resource(organization_id, client_id, 'contracts', 'view'));

DROP POLICY IF EXISTS tenant_select ON public.receivables;
CREATE POLICY tenant_select ON public.receivables FOR SELECT TO authenticated
  USING (public.can_access_client_resource(organization_id, client_id, 'receivables', 'view'));

DROP POLICY IF EXISTS tenant_select ON public.receivable_installments;
CREATE POLICY tenant_select ON public.receivable_installments FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'receivables', 'view')
    AND (
      public.current_client_id(organization_id) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.receivables r
        WHERE r.id = receivable_installments.receivable_id AND r.organization_id = receivable_installments.organization_id
          AND r.client_id = public.current_client_id(receivable_installments.organization_id)
      )
    )
  );

DROP POLICY IF EXISTS tenant_select ON public.payments;
CREATE POLICY tenant_select ON public.payments FOR SELECT TO authenticated
  USING (public.can_access_client_resource(organization_id, client_id, 'payments', 'view'));

DROP POLICY IF EXISTS tenant_select ON public.payment_reversals;
CREATE POLICY tenant_select ON public.payment_reversals FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'payments', 'view')
    AND (
      public.current_client_id(organization_id) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.id = payment_reversals.original_payment_id AND p.organization_id = payment_reversals.organization_id
          AND p.client_id = public.current_client_id(payment_reversals.organization_id)
      )
    )
  );

DROP POLICY IF EXISTS tenant_select ON public.payment_allocations;
CREATE POLICY tenant_select ON public.payment_allocations FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'payments', 'view')
    AND (
      public.current_client_id(organization_id) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.id = payment_allocations.payment_id AND p.organization_id = payment_allocations.organization_id
          AND p.client_id = public.current_client_id(payment_allocations.organization_id)
      )
    )
  );

DROP POLICY IF EXISTS tenant_select ON public.financial_adjustments;
CREATE POLICY tenant_select ON public.financial_adjustments FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'receivables', 'view')
    AND (
      public.current_client_id(organization_id) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.receivable_installments ri
        JOIN public.receivables r ON r.id = ri.receivable_id AND r.organization_id = ri.organization_id
        WHERE ri.id = financial_adjustments.installment_id AND ri.organization_id = financial_adjustments.organization_id
          AND r.client_id = public.current_client_id(financial_adjustments.organization_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.id = financial_adjustments.payment_id AND p.organization_id = financial_adjustments.organization_id
          AND p.client_id = public.current_client_id(financial_adjustments.organization_id)
      )
    )
  );

DROP POLICY IF EXISTS tenant_select ON public.renegotiations;
CREATE POLICY tenant_select ON public.renegotiations FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'receivables', 'view')
    AND (
      public.current_client_id(organization_id) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.receivables r
        WHERE r.id = renegotiations.original_receivable_id AND r.organization_id = renegotiations.organization_id
          AND r.client_id = public.current_client_id(renegotiations.organization_id)
      )
    )
  );

DROP POLICY IF EXISTS tenant_select ON public.client_messages;
CREATE POLICY tenant_select ON public.client_messages FOR SELECT TO authenticated
  USING (public.can_access_client_resource(organization_id, client_id, 'messages', 'view'));

DROP POLICY IF EXISTS tenant_select ON public.calendar_events;
CREATE POLICY tenant_select ON public.calendar_events FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'calendar', 'view')
    AND (
      public.current_client_id(organization_id) IS NULL
      OR client_id = public.current_client_id(organization_id)
    )
  );

DROP POLICY IF EXISTS tenant_select ON public.documents;
CREATE POLICY tenant_select ON public.documents FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'documents', 'view')
    AND (
      public.current_client_id(organization_id) IS NULL
      OR (
        client_id = public.current_client_id(organization_id)
        AND visibility = 'CLIENT'
      )
    )
  );

DROP POLICY IF EXISTS tenant_select ON public.document_versions;
CREATE POLICY tenant_select ON public.document_versions FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'documents', 'view')
    AND (
      public.current_client_id(organization_id) IS NULL
      OR EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.id = document_versions.document_id AND d.organization_id = document_versions.organization_id
          AND d.client_id = public.current_client_id(document_versions.organization_id)
          AND d.visibility = 'CLIENT'
          AND d.deleted_at IS NULL
      )
    )
  );

CREATE OR REPLACE FUNCTION public.storage_object_organization_id(object_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE candidate text;
BEGIN
  candidate := CASE
    WHEN split_part(object_name, '/', 1) = 'organizations' THEN split_part(object_name, '/', 2)
    ELSE split_part(object_name, '/', 1)
  END;
  IF candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN candidate::uuid;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_download_storage_object(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.document_versions dv
    JOIN public.documents d
      ON d.organization_id = dv.organization_id AND d.id = dv.document_id
    WHERE dv.storage_key = object_name
      AND d.deleted_at IS NULL
      AND public.has_permission(d.organization_id, 'documents', 'view')
      AND (
        public.current_client_id(d.organization_id) IS NULL
        OR (
          d.client_id = public.current_client_id(d.organization_id)
          AND d.visibility = 'CLIENT'
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.storage_object_organization_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_download_storage_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_object_organization_id(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_download_storage_object(text) TO authenticated;

DROP POLICY IF EXISTS legal_documents_select ON storage.objects;
DROP POLICY IF EXISTS legal_documents_insert ON storage.objects;
DROP POLICY IF EXISTS legal_documents_update ON storage.objects;
DROP POLICY IF EXISTS legal_documents_delete ON storage.objects;

CREATE POLICY legal_documents_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'legal-documents' AND public.can_download_storage_object(name));
CREATE POLICY legal_documents_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'legal-documents'
    AND public.storage_object_organization_id(name) IN (SELECT public.current_organization_ids())
    AND public.has_permission(public.storage_object_organization_id(name), 'documents', 'create')
  );
CREATE POLICY legal_documents_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'legal-documents'
    AND public.has_permission(public.storage_object_organization_id(name), 'documents', 'update')
  )
  WITH CHECK (
    bucket_id = 'legal-documents'
    AND public.has_permission(public.storage_object_organization_id(name), 'documents', 'update')
  );
CREATE POLICY legal_documents_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'legal-documents'
    AND public.has_permission(public.storage_object_organization_id(name), 'documents', 'delete')
  );

COMMIT;
