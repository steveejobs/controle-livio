-- Local/test only. All identities and business records below are fictitious.
-- Password for local users: LocalOnly-ChangeMe-2026!
DO $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'authenticated' THEN
    RAISE EXCEPTION 'Seed must run as the local database owner';
  END IF;
END;
$$;

INSERT INTO public.organizations (id, legal_name, slug, trade_name, status, updated_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Organizacao Ficticia Aurora Ltda', 'aurora-local', 'Aurora Local', 'ACTIVE', now()),
  ('20000000-0000-4000-8000-000000000001', 'Organizacao Ficticia Horizonte Ltda', 'horizonte-local', 'Horizonte Local', 'ACTIVE', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
SELECT
  '00000000-0000-0000-0000-000000000000', source.id, 'authenticated', 'authenticated',
  source.email, crypt('LocalOnly-ChangeMe-2026!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', source.full_name), now(), now(), '', '', '', ''
FROM (VALUES
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin.aurora@example.test', 'Admin Aurora'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'advogado.aurora@example.test', 'Advogado Aurora'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'secretaria.aurora@example.test', 'Secretaria Aurora'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'financeiro.aurora@example.test', 'Financeiro Aurora'),
  ('a0000000-0000-4000-8000-000000000005'::uuid, 'cliente.aurora@example.test', 'Cliente Portal Aurora'),
  ('b0000000-0000-4000-8000-000000000001'::uuid, 'admin.horizonte@example.test', 'Admin Horizonte')
) AS source(id, email, full_name)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
FROM auth.users u
WHERE u.id IN (
  'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004',
  'a0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name)
SELECT id, email, raw_user_meta_data->>'full_name' FROM auth.users
WHERE id::text LIKE ANY (ARRAY['a0000000-%', 'b0000000-%'])
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name;

INSERT INTO public.clients (id, organization_id, type, display_name, email, source, updated_at)
VALUES
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'PERSON', 'Cliente Ficticio Alfa', 'alfa@example.test', 'seed-local', now()),
  ('11000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'COMPANY', 'Empresa Ficticia Beta', 'beta@example.test', 'seed-local', now()),
  ('21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'PERSON', 'Cliente Ficticio Horizonte', 'cliente.horizonte@example.test', 'seed-local', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, auth_user_id, organization_id, client_id, email, password_hash, full_name, status, updated_at)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', NULL, 'admin.aurora@example.test', NULL, 'Admin Aurora', 'ACTIVE', now()),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', NULL, 'advogado.aurora@example.test', NULL, 'Advogado Aurora', 'ACTIVE', now()),
  ('a1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', NULL, 'secretaria.aurora@example.test', NULL, 'Secretaria Aurora', 'ACTIVE', now()),
  ('a1000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', NULL, 'financeiro.aurora@example.test', NULL, 'Financeiro Aurora', 'ACTIVE', now()),
  ('a1000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'cliente.aurora@example.test', NULL, 'Cliente Portal Aurora', 'ACTIVE', now()),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', NULL, 'admin.horizonte@example.test', NULL, 'Admin Horizonte', 'ACTIVE', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (id, organization_id, profile_id, user_id, client_id, status)
VALUES
  ('a2000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', NULL, 'ACTIVE'),
  ('a2000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', NULL, 'ACTIVE'),
  ('a2000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', NULL, 'ACTIVE'),
  ('a2000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004', NULL, 'ACTIVE'),
  ('a2000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000001', 'ACTIVE'),
  ('b2000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', NULL, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

WITH resources(resource) AS (
  SELECT unnest(ARRAY['organization','users','roles','clients','matters','pipelines','contracts','receivables','payments','expenses','documents','notes','messages','tasks','calendar','notifications','audit','reports'])
), actions(action) AS (
  SELECT unnest(ARRAY['view','create','update','delete','export','approve','manage'])
), organizations(id) AS (
  VALUES ('10000000-0000-4000-8000-000000000001'::uuid), ('20000000-0000-4000-8000-000000000001'::uuid)
)
INSERT INTO public.permissions (id, organization_id, resource, action, description)
SELECT gen_random_uuid(), o.id, r.resource, a.action, 'Permissao local ' || r.resource || ':' || a.action
FROM organizations o CROSS JOIN resources r CROSS JOIN actions a
ON CONFLICT (organization_id, resource, action) DO NOTHING;

INSERT INTO public.roles (id, organization_id, key, name, is_system, updated_at)
VALUES
  ('a3000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'administrator', 'Administrador', true, now()),
  ('a3000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'lawyer', 'Advogado', true, now()),
  ('a3000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'secretary', 'Secretaria', true, now()),
  ('a3000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'finance', 'Financeiro', true, now()),
  ('a3000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'client', 'Cliente', true, now()),
  ('b3000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'administrator', 'Administrador', true, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM public.roles r JOIN public.permissions p ON p.organization_id = r.organization_id
WHERE r.key = 'administrator'
   OR (r.key = 'lawyer' AND (
     (p.resource IN ('clients','matters','documents','notes','messages','tasks','calendar') AND p.action IN ('view','create','update','export'))
     OR (p.resource IN ('pipelines','receivables') AND p.action = 'view')
     OR (p.resource = 'contracts' AND p.action IN ('view','create','update'))
     OR (p.resource = 'notifications' AND p.action IN ('view','update'))
     OR (p.resource = 'reports' AND p.action IN ('view','export'))
   ))
   OR (r.key = 'secretary' AND (
     (p.resource IN ('clients','notes','messages','tasks','calendar') AND p.action IN ('view','create','update','export'))
     OR (p.resource IN ('matters','documents') AND p.action IN ('view','create','update'))
     OR (p.resource = 'pipelines' AND p.action = 'view')
     OR (p.resource = 'notifications' AND p.action IN ('view','update'))
     OR (p.resource = 'reports' AND p.action IN ('view','export'))
   ))
   OR (r.key = 'finance' AND (
     (p.resource IN ('clients','matters','documents','calendar') AND p.action = 'view')
     OR (p.resource IN ('contracts','receivables','payments','expenses') AND p.action IN ('view','create','update','approve','export'))
     OR (p.resource = 'messages' AND p.action IN ('view','create'))
     OR (p.resource = 'tasks' AND p.action IN ('view','create','update','export'))
     OR (p.resource = 'notifications' AND p.action IN ('view','update'))
     OR (p.resource = 'reports' AND p.action IN ('view','export'))
   ))
   OR (r.key = 'client' AND (
     (p.resource IN ('matters','contracts','receivables','payments','documents','calendar') AND p.action = 'view')
     OR (p.resource = 'messages' AND p.action IN ('view','create'))
     OR (p.resource = 'notifications' AND p.action IN ('view','update'))
   ))
ON CONFLICT DO NOTHING;

INSERT INTO public.organization_member_roles (organization_id, membership_id, role_id)
VALUES
  ('10000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000004'),
  ('10000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000005'),
  ('20000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (organization_id, user_id, role_id)
SELECT omr.organization_id, om.user_id, omr.role_id
FROM public.organization_member_roles omr JOIN public.organization_members om ON om.id = omr.membership_id
ON CONFLICT DO NOTHING;

INSERT INTO public.pipelines (id, organization_id, name, kind, updated_at)
VALUES
  ('12000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Juridico Local','LEGAL',now()),
  ('22000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Juridico Local','LEGAL',now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pipeline_stages (id, organization_id, pipeline_id, name, position, color, updated_at)
VALUES
  ('13000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','Triagem',1,'#4f766c',now()),
  ('23000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','Triagem',1,'#4f766c',now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.matters (id, organization_id, client_id, pipeline_id, current_stage_id, reference, title, status, priority, updated_at)
VALUES
  ('14000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','AUR-001','Processo Ficticio Alfa','ACTIVE','MEDIUM',now()),
  ('24000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','HOR-001','Processo Ficticio Horizonte','ACTIVE','MEDIUM',now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.contracts (id, organization_id, client_id, matter_id, number, title, status, fee_model, fixed_amount, updated_at)
VALUES
  ('15000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','AUR-CT-001','Contrato Ficticio Alfa','ACTIVE','FIXED',1500.00,now()),
  ('25000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','HOR-CT-001','Contrato Ficticio Horizonte','ACTIVE','FIXED',900.00,now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.receivables (id, organization_id, client_id, matter_id, contract_id, reference, description, status, original_amount, issue_date, due_date, updated_at)
VALUES
  ('16000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','AUR-REC-001','Recebivel Ficticio Alfa','OPEN',1500.00,current_date,current_date + 30,now()),
  ('26000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','HOR-REC-001','Recebivel Ficticio Horizonte','OPEN',900.00,current_date,current_date + 30,now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.internal_notes (id, organization_id, client_id, matter_id, body, created_by_id, updated_at)
VALUES ('17000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','Nota interna ficticia e confidencial.','a1000000-0000-4000-8000-000000000002',now())
ON CONFLICT (id) DO NOTHING;
