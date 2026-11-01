BEGIN;

CREATE TABLE public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  document_id uuid NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  installment_id uuid REFERENCES public.receivable_installments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  payment_id uuid UNIQUE REFERENCES public.payments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  sha256 char(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'PENDING_REVIEW',
  extracted_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_by_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  submitted_by_client boolean NOT NULL DEFAULT false,
  reviewed_by_id uuid REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  reviewed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_receipts_target_check CHECK (num_nonnulls(installment_id, expense_id) = 1),
  CONSTRAINT payment_receipts_status_check CHECK (status IN ('PENDING_REVIEW', 'CONFIRMED', 'REJECTED', 'NEEDS_CORRECTION')),
  CONSTRAINT payment_receipts_hash_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT payment_receipts_organization_hash_key UNIQUE (organization_id, sha256),
  CONSTRAINT payment_receipts_fields_check CHECK (jsonb_typeof(extracted_fields) = 'object'),
  CONSTRAINT payment_receipts_reconciliation_check CHECK (jsonb_typeof(reconciliation) = 'object'),
  CONSTRAINT payment_receipts_history_check CHECK (jsonb_typeof(review_history) = 'array')
);

CREATE INDEX payment_receipts_organization_client_status_idx ON public.payment_receipts(organization_id, client_id, status);
CREATE INDEX payment_receipts_organization_installment_status_idx ON public.payment_receipts(organization_id, installment_id, status);
CREATE INDEX payment_receipts_organization_expense_status_idx ON public.payment_receipts(organization_id, expense_id, status);

DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('clients', 'client_id'), ('documents', 'document_id'),
    ('receivable_installments', 'installment_id'), ('expenses', 'expense_id'),
    ('payments', 'payment_id'), ('users', 'submitted_by_id'), ('users', 'reviewed_by_id')
  ) AS target(parent_table, column_name) LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF organization_id, %I ON public.payment_receipts FOR EACH ROW EXECUTE FUNCTION public.enforce_same_organization(%L, %L)',
      'tenant_payment_receipts_' || item.column_name, item.column_name, item.parent_table, item.column_name);
  END LOOP;
END $$;

CREATE FUNCTION public.validate_payment_receipt_target() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_client uuid;
BEGIN
  IF NEW.installment_id IS NOT NULL THEN
    SELECT r.client_id INTO target_client FROM public.receivable_installments i
      JOIN public.receivables r ON r.id = i.receivable_id
      WHERE i.id = NEW.installment_id AND i.organization_id = NEW.organization_id;
  ELSE
    SELECT e.client_id INTO target_client FROM public.expenses e
      WHERE e.id = NEW.expense_id AND e.organization_id = NEW.organization_id;
  END IF;
  IF target_client IS NULL OR target_client <> NEW.client_id THEN
    RAISE EXCEPTION 'Receipt client does not match financial target' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = NEW.document_id
      AND d.organization_id = NEW.organization_id AND d.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'Receipt document does not match client' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_receipts_validate_target BEFORE INSERT OR UPDATE OF organization_id, client_id, document_id, installment_id, expense_id
ON public.payment_receipts FOR EACH ROW EXECUTE FUNCTION public.validate_payment_receipt_target();

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts FORCE ROW LEVEL SECURITY;
-- Receipts are read and modified through the API only. It enforces the client and finance roles.

INSERT INTO public.permissions (organization_id, resource, action, description)
SELECT o.id, 'receipts', permission_action.action, 'Comprovantes financeiros'
FROM public.organizations o CROSS JOIN unnest(ARRAY['view', 'create', 'approve']) AS permission_action(action)
ON CONFLICT (organization_id, resource, action) DO NOTHING;

INSERT INTO public.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM public.roles r JOIN public.permissions p ON p.organization_id = r.organization_id
WHERE p.resource = 'receipts' AND (
  r.key = 'administrator'
  OR (r.key = 'finance' AND p.action IN ('view', 'create', 'approve'))
  OR (r.key IN ('client', 'lawyer', 'secretary') AND p.action IN ('view', 'create'))
)
ON CONFLICT DO NOTHING;

COMMIT;
