-- The canonical workflow event (§8.2) — the only thing workflow measurement
-- is permitted to read.
--
-- Oddjob analyses what it is explicitly given: its own missions and pipelines,
-- records from configured connectors, uploaded files with a declared column
-- mapping, and labelled human attestations. `source_type` carries which, and
-- `attestation` is deliberately a distinct value: a person's recollection of
-- how long a step took is evidence of a different kind from a timestamp, and a
-- report that blends them is not reproducible.
--
-- `actor_id_hash` rather than an actor id. Aggregate timing analysis rarely
-- needs to name a person, and naming one turns an operations report into
-- personnel analytics — which §14 treats as high-risk and unavailable by
-- default.
--
-- The unique index on (organization_id, workflow_key, event_id) makes re-import
-- idempotent. Uploading the same spreadsheet twice must not double a case
-- count, because every rate in the measurement report divides by it.

CREATE TABLE IF NOT EXISTS "workflow_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "project_id" integer,
    "workflow_key" text NOT NULL,
    "case_id" text NOT NULL,
    "event_id" text NOT NULL,
    -- entered | started | completed | handed_off | reopened | approved
    -- | rejected | cancelled
    "event_type" text NOT NULL,
    "step_key" text NOT NULL,
    -- 'user' | 'agent' | 'system'
    "actor_type" text,
    "actor_id_hash" text,
    "occurred_at" timestamp NOT NULL,
    -- 'oddjob' | 'connector' | 'upload' | 'attestation'
    "source_type" text NOT NULL,
    "source_reference" text NOT NULL,
    "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "ingested_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "workflow_events"
        ADD CONSTRAINT "workflow_events_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Re-importing the same source event is a no-op, not a duplicated case.
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_events_org_workflow_event_unique"
    ON "workflow_events" ("organization_id", "workflow_key", "event_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "workflow_events_org_workflow_case_idx"
    ON "workflow_events" ("organization_id", "workflow_key", "case_id", "occurred_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "workflow_events_org_workflow_time_idx"
    ON "workflow_events" ("organization_id", "workflow_key", "occurred_at");
