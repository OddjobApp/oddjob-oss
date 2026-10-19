-- 0142_forge_releases
--
-- DRIFT REPAIR: forge_releases is declared in shared/schema/apps/forge-releases.ts
-- and has been present in the legacy drizzle snapshots since 0055, but no SQL
-- file in either migration chain ever created it — not the baseline, not a
-- runtime migration, not the legacy series. Every query against it throws
-- "relation forge_releases does not exist"; first observed as a 500 on
-- GET /api/resource-catalog/impact/mission:213 via collectAppReleases.
--
-- Same class of failure as 0077_drift_repair_baselined_tables.sql. Columns,
-- defaults, indexes and constraint names are copied from the drizzle snapshot
-- (migrations/meta/0066_snapshot.json) so the result matches what drizzle-kit
-- would have emitted. Everything is guarded, so an environment that already
-- has the table is left unchanged.

CREATE TABLE IF NOT EXISTS "forge_releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"version" text NOT NULL,
	"artifact_hash" text,
	"qa_evidence" jsonb DEFAULT '{}'::jsonb,
	"security_scan_result" jsonb DEFAULT '{}'::jsonb,
	"approval_request_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"deployed_at" timestamp with time zone,
	"deployed_by" text,
	"rollback_from_release_id" integer,
	"organization_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_forge_releases_app" ON "forge_releases" ("app_id");
CREATE INDEX IF NOT EXISTS "idx_forge_releases_org" ON "forge_releases" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_forge_releases_status" ON "forge_releases" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_forge_releases_app_version" ON "forge_releases" ("app_id", "version");

-- ADD CONSTRAINT has no IF NOT EXISTS, so each is guarded.
DO $$ BEGIN
  BEGIN
    ALTER TABLE "forge_releases" ADD CONSTRAINT "forge_releases_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "forge_releases" ADD CONSTRAINT "forge_releases_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
