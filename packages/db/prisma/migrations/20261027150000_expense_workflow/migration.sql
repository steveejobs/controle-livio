BEGIN;

ALTER TYPE public."ExpenseStatus" ADD VALUE IF NOT EXISTS 'REJECTED' BEFORE 'PAID';

ALTER TABLE public."expenses"
  ADD COLUMN IF NOT EXISTS "responsible_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "rejected_by_id" UUID,
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "rejection_reason" VARCHAR(500);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.expenses'::regclass
       AND conname = 'expenses_responsible_user_id_fkey'
  ) THEN
    ALTER TABLE public."expenses"
      ADD CONSTRAINT "expenses_responsible_user_id_fkey"
      FOREIGN KEY ("responsible_user_id") REFERENCES public."users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.expenses'::regclass
       AND conname = 'expenses_rejected_by_id_fkey'
  ) THEN
    ALTER TABLE public."expenses"
      ADD CONSTRAINT "expenses_rejected_by_id_fkey"
      FOREIGN KEY ("rejected_by_id") REFERENCES public."users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "expenses_organization_id_status_paid_at_idx"
  ON public."expenses"("organization_id", "status", "paid_at");
CREATE INDEX IF NOT EXISTS "expenses_organization_id_responsible_user_id_status_idx"
  ON public."expenses"("organization_id", "responsible_user_id", "status");

COMMIT;
