-- Capability-gap telemetry: the evidence source §6 of the improvement spec
-- consumes, which until now was never recorded anywhere.
--
-- The missing-tool guard in `tool-executor.service.ts` returns a bare string
-- BEFORE `startTime`, before the analytics import, and before the forensic start
-- event. A capability an agent tried and could not use therefore reached no
-- table and no trace, and read in the transcript exactly like a tool that ran
-- and reported an error. Every component of the §6.3 priority score needs
-- `unique_affected_runs`; nothing existed to derive one from.
--
-- `organization_id` is NOT NULL here, unlike migrations 0087 and 0088. Those
-- retrofitted a tenant column onto tables that already existed and might hold
-- unattributed rows. This table is new, so the emitter can fail closed: an event
-- whose organization does not resolve is dropped and counted as a rejection
-- rather than written under a default tenant.

CREATE TABLE IF NOT EXISTS "capability_gap_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "project_id" integer,
    "mission_id" integer,
    -- The deduplication unit. NULL means no run identity was available; such
    -- rows are excluded from frequency scoring, never given a synthetic id.
    "run_ref" text,
    "run_ref_source" text,
    "requested_tool_name" text NOT NULL,
    "canonical_tool_name" text,
    -- 'missing' | 'unavailable' | 'unauthorized' | 'incompatible'
    "failure_class" text NOT NULL,
    "registry_hit" boolean NOT NULL,
    "allotment_hit" boolean NOT NULL,
    "occurred_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "capability_gap_events"
        ADD CONSTRAINT "capability_gap_events_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "capability_gap_events_org_occurred_idx"
    ON "capability_gap_events" ("organization_id", "occurred_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "capability_gap_events_org_class_tool_idx"
    ON "capability_gap_events" ("organization_id", "failure_class", "requested_tool_name");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "capability_gap_events_org_run_idx"
    ON "capability_gap_events" ("organization_id", "run_ref");
