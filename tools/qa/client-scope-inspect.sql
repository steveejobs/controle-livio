-- Read-only operator preflight/postcheck; never infer a replacement binding.
SELECT om.id AS membership_id, om.organization_id, om.client_id, om.status,
       array_agg(DISTINCT r.key ORDER BY r.key) AS role_keys
FROM public.organization_members om
JOIN public.organization_member_roles mr ON mr.membership_id = om.id AND mr.organization_id = om.organization_id
JOIN public.roles r ON r.id = mr.role_id AND r.organization_id = mr.organization_id
LEFT JOIN public.clients c ON c.id = om.client_id AND c.organization_id = om.organization_id AND c.deleted_at IS NULL
WHERE om.status = 'ACTIVE'
GROUP BY om.id, om.organization_id, om.client_id, om.status, c.id
HAVING bool_or(r.key = 'client')
   AND NOT bool_or(r.key IN ('administrator', 'lawyer', 'secretary', 'finance'))
   AND c.id IS NULL;

SELECT mr.membership_id, mr.organization_id AS assignment_organization,
       om.organization_id AS membership_organization,
       mr.role_id, r.organization_id AS role_organization
FROM public.organization_member_roles mr
JOIN public.organization_members om ON om.id = mr.membership_id
JOIN public.roles r ON r.id = mr.role_id
WHERE mr.organization_id IS DISTINCT FROM om.organization_id
   OR r.organization_id IS DISTINCT FROM om.organization_id;

SELECT p.oid::regprocedure AS function, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
WHERE p.oid IN ('public.has_permission(uuid,text,text)'::regprocedure,
                'public.current_organization_ids()'::regprocedure,
                'public.current_client_id(uuid)'::regprocedure);
