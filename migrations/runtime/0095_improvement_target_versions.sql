-- Durable versions for mutable targets (§9.3).
--
-- Two things did not exist before this, and both matter at apply time:
--
-- 1. `expected_version` on a change set was a string with nothing producing it,
--    so the staleness check in the approval verifier had nothing authoritative
--    to compare against.
-- 2. Rollback had nothing to restore FROM. The existing blueprint PATCH keeps
--    at most ten metadata history entries, and only while a cycle is active or
--    paused — so the version a change set was authored against could vanish
--    before the change set was applied.
--
-- Rows are immutable except for `verified_at`. A new state is a new row, which
-- is what makes "restore a previously verified version" a real operation.
--
-- `verified_at` is the reason rollback is safe: it targets a version that was
-- confirmed healthy after application, not merely a previous one. Restoring to
-- a state that was itself broken is not a recovery.
--
-- `source` keeps packaged YAML, an organization fork, a runtime customization
-- and a generated draft distinguishable — §9.3 requires that ownership be
-- visible so one is never silently overwritten by another.

CREATE TABLE IF NOT EXISTS "improvement_target_versions" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    -- 'cycle_blueprint' | 'cycle_schedule' | 'pipeline_step' | 'forge_app'
    "target_type" text NOT NULL,
    "target_id" text NOT NULL,

    -- Monotonic per target, starting at 1. Rendered as v{n}.
    "version_number" integer NOT NULL,
    "content_hash" text NOT NULL,
    "snapshot" jsonb NOT NULL,

    -- 'packaged_yaml' | 'org_fork' | 'runtime_customization'
    -- | 'generated_draft' | 'restored'
    "source" text NOT NULL,
    "produced_by_change_set_id" integer,
    -- Set only after the applied version was verified healthy. Rollback targets
    -- these and nothing else.
    "verified_at" timestamp,

    "created_by" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_target_versions"
        ADD CONSTRAINT "improvement_target_versions_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "improvement_target_versions_unique"
    ON "improvement_target_versions" ("organization_id", "target_type", "target_id", "version_number");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "improvement_target_versions_target_idx"
    ON "improvement_target_versions" ("organization_id", "target_type", "target_id");
