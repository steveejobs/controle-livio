BEGIN;

-- A client membership has clients:view for its own record. Scope direct SQL access as well as API reads.
DROP POLICY IF EXISTS tenant_select ON public.clients;
CREATE POLICY tenant_select ON public.clients FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'clients', 'view')
    AND (public.current_client_id(organization_id) IS NULL OR id = public.current_client_id(organization_id))
  );

DROP POLICY IF EXISTS tenant_select ON public.client_contacts;
CREATE POLICY tenant_select ON public.client_contacts FOR SELECT TO authenticated
  USING (public.can_access_client_resource(organization_id, client_id, 'clients', 'view'));

-- Notification permission grants use of the inbox, never access to another member's messages.
DROP POLICY IF EXISTS tenant_select ON public.notifications;
CREATE POLICY tenant_select ON public.notifications FOR SELECT TO authenticated
  USING (
    public.has_permission(organization_id, 'notifications', 'view')
    AND EXISTS (
      SELECT 1 FROM public.organization_members member
      WHERE member.organization_id = notifications.organization_id
        AND member.profile_id = auth.uid()
        AND member.user_id = notifications.user_id
        AND member.status = 'ACTIVE'
    )
  );

COMMIT;
