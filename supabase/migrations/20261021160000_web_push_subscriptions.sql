BEGIN;

CREATE TABLE "web_push_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" VARCHAR(255) NOT NULL,
  "auth" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "web_push_subscriptions_endpoint_length_check"
    CHECK (length("endpoint") BETWEEN 1 AND 2048),
  CONSTRAINT "web_push_subscriptions_p256dh_check"
    CHECK ("p256dh" ~ '^[A-Za-z0-9_-]{16,255}$'),
  CONSTRAINT "web_push_subscriptions_auth_check"
    CHECK ("auth" ~ '^[A-Za-z0-9_-]{16,255}$')
);

CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key"
  ON "web_push_subscriptions"("endpoint");
CREATE INDEX "web_push_subscriptions_organization_id_user_id_idx"
  ON "web_push_subscriptions"("organization_id", "user_id");

ALTER TABLE "web_push_subscriptions"
  ADD CONSTRAINT "web_push_subscriptions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "web_push_subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "tenant_web_push_subscriptions_user_id"
  BEFORE INSERT OR UPDATE OF "organization_id", "user_id" ON "web_push_subscriptions"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_organization('users', 'user_id');

ALTER TABLE "web_push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_push_subscriptions" FORCE ROW LEVEL SECURITY;
-- Push subscriptions are accessed only by the authenticated API; browser roles receive no policy.

COMMIT;
