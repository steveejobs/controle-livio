BEGIN;

CREATE TABLE "service_catalog_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "normalized_name" VARCHAR(160) NOT NULL,
  "area" VARCHAR(20) NOT NULL DEFAULT 'GENERAL',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_catalog_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_catalog_items_name_check" CHECK (length(trim("name")) BETWEEN 2 AND 160),
  CONSTRAINT "service_catalog_items_normalized_name_check"
    CHECK (length(trim("normalized_name")) BETWEEN 2 AND 160),
  CONSTRAINT "service_catalog_items_area_check" CHECK ("area" IN ('GENERAL', 'CRIMINAL')),
  CONSTRAINT "service_catalog_items_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "service_catalog_items_organization_id_normalized_name_key"
  ON "service_catalog_items"("organization_id", "normalized_name");
CREATE INDEX "service_catalog_items_organization_id_area_name_idx"
  ON "service_catalog_items"("organization_id", "area", "name");

ALTER TABLE "service_catalog_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_catalog_items" FORCE ROW LEVEL SECURITY;
-- Catalog access is scoped and authorized by the API; browser roles have no direct policy.

COMMIT;
