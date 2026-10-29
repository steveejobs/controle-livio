BEGIN;

DROP POLICY IF EXISTS tenant_insert ON public.client_messages;
CREATE POLICY tenant_insert ON public.client_messages FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_client_resource(organization_id, client_id, 'messages', 'create')
    AND EXISTS (
      SELECT 1 FROM public.organization_members member
      WHERE member.organization_id = client_messages.organization_id
        AND member.profile_id = auth.uid()
        AND member.user_id = client_messages.created_by_id
        AND member.status = 'ACTIVE'
    )
    AND (matter_id IS NULL OR EXISTS (
      SELECT 1 FROM public.matters matter
      WHERE matter.organization_id = client_messages.organization_id
        AND matter.id = client_messages.matter_id
        AND matter.client_id = client_messages.client_id
    ))
  );

DROP POLICY IF EXISTS tenant_update ON public.notifications;
CREATE POLICY tenant_update ON public.notifications FOR UPDATE TO authenticated
  USING (
    public.has_permission(organization_id, 'notifications', 'update')
    AND EXISTS (
      SELECT 1 FROM public.organization_members member
      WHERE member.organization_id = notifications.organization_id
        AND member.profile_id = auth.uid()
        AND member.user_id = notifications.user_id
        AND member.status = 'ACTIVE'
    )
  )
  WITH CHECK (
    public.has_permission(organization_id, 'notifications', 'update')
    AND EXISTS (
      SELECT 1 FROM public.organization_members member
      WHERE member.organization_id = notifications.organization_id
        AND member.profile_id = auth.uid()
        AND member.user_id = notifications.user_id
        AND member.status = 'ACTIVE'
    )
  );

COMMIT;
