-- 0140_studio_entitlements
--
-- Org-scoped feature entitlements for CREW studios. Introduces a runtime gate
-- so individual studios can be offered as Marketplace add-ons without changing
-- the studio code itself.
--
-- Seeds every existing organization with the first gated studios so existing
-- users keep access after this migration runs.

CREATE TABLE IF NOT EXISTS "organization_studio_entitlements" (
    "id" SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "studio_kind" VARCHAR(32) NOT NULL,
    "installed_by_user_id" VARCHAR(255),
    "installed_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_org_studio_entitlements_unique"
    ON "organization_studio_entitlements" ("organization_id", "studio_kind");

CREATE INDEX IF NOT EXISTS "idx_org_studio_entitlements_org"
    ON "organization_studio_entitlements" ("organization_id");

CREATE INDEX IF NOT EXISTS "idx_org_studio_entitlements_studio"
    ON "organization_studio_entitlements" ("studio_kind");

-- Backfill: every existing organization gets the initial gated studios enabled,
-- preserving current behavior after the entitlement check is turned on.
INSERT INTO "organization_studio_entitlements" ("organization_id", "studio_kind")
SELECT "org_id", kind
FROM "orgs",
    (VALUES ('media'), ('prediction'), ('computer'), ('signal')) AS studios(kind)
ON CONFLICT ("organization_id", "studio_kind") DO NOTHING;
