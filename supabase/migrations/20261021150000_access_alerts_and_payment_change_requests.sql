BEGIN;

CREATE TYPE "PaymentChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "payment_change_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "proposed_data" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "PaymentChangeStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMPTZ(3),
  "review_note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_change_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_change_requests_reason_check" CHECK (length(btrim("reason")) BETWEEN 3 AND 500),
  CONSTRAINT "payment_change_requests_proposed_data_check" CHECK (jsonb_typeof("proposed_data") = 'object'),
  CONSTRAINT "payment_change_requests_review_check" CHECK (
    ("status" = 'PENDING' AND "reviewed_at" IS NULL AND "reviewed_by_id" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "reviewed_at" IS NOT NULL AND "reviewed_by_id" IS NOT NULL)
  )
);

CREATE INDEX "payment_change_requests_organization_id_status_created_at_idx"
  ON "payment_change_requests"("organization_id", "status", "created_at");
CREATE INDEX "payment_change_requests_organization_id_payment_id_created_at_idx"
  ON "payment_change_requests"("organization_id", "payment_id", "created_at");
CREATE INDEX "activity_events_organization_id_type_occurred_at_idx"
  ON "activity_events"("organization_id", "type", "occurred_at");

CREATE FUNCTION public.protect_system_access_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.type = 'SYSTEM_ACCESS' THEN
    RAISE EXCEPTION 'System access history cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "immutable_system_access_events"
  BEFORE UPDATE OR DELETE ON "activity_events"
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_access_event();

ALTER TABLE "payment_change_requests"
  ADD CONSTRAINT "payment_change_requests_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_change_requests_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_change_requests_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_change_requests_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "tenant_payment_change_requests_payment_id"
  BEFORE INSERT OR UPDATE OF "organization_id", "payment_id" ON "payment_change_requests"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_organization('payments', 'payment_id');
CREATE TRIGGER "tenant_payment_change_requests_created_by_id"
  BEFORE INSERT OR UPDATE OF "organization_id", "created_by_id" ON "payment_change_requests"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_organization('users', 'created_by_id');
CREATE TRIGGER "tenant_payment_change_requests_reviewed_by_id"
  BEFORE INSERT OR UPDATE OF "organization_id", "reviewed_by_id" ON "payment_change_requests"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_organization('users', 'reviewed_by_id');

ALTER TABLE "payment_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_change_requests" FORCE ROW LEVEL SECURITY;
-- Payment amendments are only accessed through the authenticated API, which enforces
-- administrator review and tenant scoping. No direct browser policy is granted.

COMMIT;
