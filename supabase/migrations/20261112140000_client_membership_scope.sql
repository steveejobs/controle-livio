-- DEF018: additive authorization repair; does not rewrite existing memberships.
-- Existing invalid memberships remain fail-closed until an administrator repairs
-- their explicit client binding or suspends them. No automatic staff promotion.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.has_permission(uuid,text,text)') IS NULL
     OR to_regprocedure('public.current_client_id(uuid)') IS NULL
     OR to_regprocedure('public.current_organization_ids()') IS NULL THEN
    RAISE EXCEPTION 'Membership authorization dependencies are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('organization_members', 'organization_member_roles', 'roles', 'clients', 'users')
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Membership authorization requires existing RLS';
  END IF;
END $$;

-- Preserve each function identity, owner and EXECUTE ACL with CREATE OR REPLACE.
-- Explicit professional roles take precedence over an additional Client role.
-- Client + unclassified custom roles stays client-scoped; custom roles alone
-- retain their explicitly assigned permissions. This matches client-scope.ts.
CREATE OR REPLACE FUNCTION public.has_permission(
  target_organization_id uuid, target_resource text, target_action text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    JOIN public.users u ON u.id = om.user_id AND u.organization_id = om.organization_id
    JOIN public.organizations o ON o.id = om.organization_id
    JOIN public.organization_member_roles omr
      ON omr.organization_id = om.organization_id AND omr.membership_id = om.id
    JOIN public.roles r ON r.id = omr.role_id AND r.organization_id = om.organization_id
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.organization_id = r.organization_id
    JOIN public.permissions p ON p.id = rp.permission_id AND p.organization_id = rp.organization_id
    WHERE om.profile_id = auth.uid() AND om.organization_id = target_organization_id
      AND om.status = 'ACTIVE' AND o.status = 'ACTIVE'
      AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_member_roles mr
        LEFT JOIN public.roles rk ON rk.id = mr.role_id
        WHERE mr.membership_id = om.id AND (mr.organization_id <> om.organization_id
          OR rk.organization_id IS DISTINCT FROM om.organization_id)
      )
      AND p.resource = target_resource AND p.action = target_action
      AND (om.client_id IS NULL OR EXISTS (
        SELECT 1 FROM public.clients c WHERE c.id = om.client_id
          AND c.organization_id = om.organization_id AND c.deleted_at IS NULL
      ))
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.organization_member_roles cr
          JOIN public.roles rk ON rk.id = cr.role_id AND rk.organization_id = cr.organization_id
          WHERE cr.membership_id = om.id AND cr.organization_id = om.organization_id AND rk.key = 'client'
        )
        OR EXISTS (
          SELECT 1 FROM public.organization_member_roles sr
          JOIN public.roles rk ON rk.id = sr.role_id AND rk.organization_id = sr.organization_id
          WHERE sr.membership_id = om.id AND sr.organization_id = om.organization_id
            AND rk.key IN ('administrator', 'lawyer', 'secretary', 'finance')
        )
        OR om.client_id IS NOT NULL
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.current_client_id(target_organization_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.organization_member_roles cr
    JOIN public.roles rk ON rk.id = cr.role_id AND rk.organization_id = cr.organization_id
    WHERE cr.membership_id = om.id AND cr.organization_id = om.organization_id AND rk.key = 'client'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.organization_member_roles sr
    JOIN public.roles rk ON rk.id = sr.role_id AND rk.organization_id = sr.organization_id
    WHERE sr.membership_id = om.id AND sr.organization_id = om.organization_id
      AND rk.key IN ('administrator', 'lawyer', 'secretary', 'finance')
  ) THEN om.client_id ELSE NULL END
  FROM public.organization_members om
  JOIN public.users u ON u.id = om.user_id AND u.organization_id = om.organization_id
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.profile_id = auth.uid() AND om.organization_id = target_organization_id
    AND om.status = 'ACTIVE' AND o.status = 'ACTIVE'
    AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_member_roles mr
      LEFT JOIN public.roles rk ON rk.id = mr.role_id
      WHERE mr.membership_id = om.id AND (mr.organization_id <> om.organization_id
        OR rk.organization_id IS DISTINCT FROM om.organization_id)
    )
    AND (om.client_id IS NULL OR EXISTS (
      SELECT 1 FROM public.clients c WHERE c.id = om.client_id
        AND c.organization_id = om.organization_id AND c.deleted_at IS NULL
    ))
  LIMIT 1
$$;

-- Organization metadata must not remain a fallback path for an invalid scope.
CREATE OR REPLACE FUNCTION public.current_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT om.organization_id
  FROM public.organization_members om
  JOIN public.users u ON u.id = om.user_id AND u.organization_id = om.organization_id
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.profile_id = auth.uid() AND om.status = 'ACTIVE' AND o.status = 'ACTIVE'
    AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_member_roles mr
      LEFT JOIN public.roles rk ON rk.id = mr.role_id
      WHERE mr.membership_id = om.id AND (mr.organization_id <> om.organization_id
        OR rk.organization_id IS DISTINCT FROM om.organization_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.organization_member_roles mr
      JOIN public.roles rk ON rk.id = mr.role_id AND rk.organization_id = mr.organization_id
      WHERE mr.membership_id = om.id AND mr.organization_id = om.organization_id
    )
    AND (om.client_id IS NULL OR EXISTS (
      SELECT 1 FROM public.clients c WHERE c.id = om.client_id
        AND c.organization_id = om.organization_id AND c.deleted_at IS NULL
    ))
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.organization_member_roles cr
        JOIN public.roles rk ON rk.id = cr.role_id AND rk.organization_id = cr.organization_id
        WHERE cr.membership_id = om.id AND cr.organization_id = om.organization_id AND rk.key = 'client'
      )
      OR EXISTS (
        SELECT 1 FROM public.organization_member_roles sr
        JOIN public.roles rk ON rk.id = sr.role_id AND rk.organization_id = sr.organization_id
        WHERE sr.membership_id = om.id AND sr.organization_id = om.organization_id
          AND rk.key IN ('administrator', 'lawyer', 'secretary', 'finance')
      )
      OR om.client_id IS NOT NULL
    )
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.has_permission(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.has_permission(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.current_client_id(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.current_client_id(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.current_organization_ids()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.current_organization_ids()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected authorization helper EXECUTE privileges; investigate before applying';
  END IF;
END $$;

COMMIT;
