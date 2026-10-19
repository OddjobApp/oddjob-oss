-- The evidence spine for evidence-driven improvement loops.
--
-- Three tables: an opportunity (the thing being investigated), the immutable
-- observations it cites, and the hypotheses drawn from them. Experiments,
-- results and change sets follow in later milestones.
--
-- Two design points worth stating, because both were deliberate departures:
--
-- 1. `confidence` is `integer` 0-100, not `numeric`. Drizzle surfaces
--    numeric/decimal as a STRING, which has produced silent comparison bugs in
--    this codebase before, and `capability_proposals.confidence` is already an
--    integer 0-100. Matching it keeps the two comparable.
--
-- 2. `improvement_observations` has no `updated_at`. An observation is a record
--    that something was seen. Correcting one means writing a new observation —
--    editing history that a claim already cites is how provenance stops meaning
--    anything. The unique index on (opportunity_id, content_hash) makes
--    re-ingesting the same source event a no-op rather than a duplicate that
--    inflates every frequency count built on top of it.
--
-- `organization_id` is NOT NULL throughout: these tables are new, so there are
-- no unattributed legacy rows to accommodate.

CREATE TABLE IF NOT EXISTS "improvement_opportunities" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "project_id" integer,
    -- 'capability_gap' | 'policy_candidate' | 'workflow_candidate'
    "kind" text NOT NULL,
    "title" text NOT NULL,
    -- observed | investigating | proposed | approved | experimenting
    -- | evaluating | promoted | revised | rejected | archived
    "status" text DEFAULT 'observed' NOT NULL,
    "source_window_start" timestamp,
    "source_window_end" timestamp,
    -- 'user' | 'agent' | 'service'
    "created_by_type" text NOT NULL,
    "created_by_id" text NOT NULL,
    -- Confidence in the DESCRIPTION, not the probability of success.
    "confidence" integer DEFAULT 0 NOT NULL,
    "assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "improvement_observations" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "opportunity_id" integer NOT NULL,
    -- mission_event | tool_failure | approval | workflow_event | incident
    -- | dataset_record | document | human_attestation
    "source_type" text NOT NULL,
    "source_id" text NOT NULL,
    -- When the source event happened, as distinct from when we recorded it.
    "observed_at" timestamp NOT NULL,
    "ingested_at" timestamp DEFAULT now() NOT NULL,
    -- Typed, minimally transformed facts. Never a causal claim.
    "facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "content_hash" text NOT NULL,
    "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "improvement_hypotheses" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "opportunity_id" integer NOT NULL,
    "statement" text NOT NULL,
    "mechanism" text,
    "supporting_observation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
    -- Counter-evidence, stored with equal standing so a hypothesis cannot be
    -- surfaced without it.
    "contradicting_observation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "unknowns" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "author_type" text NOT NULL,
    "author_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_opportunities"
        ADD CONSTRAINT "improvement_opportunities_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_observations"
        ADD CONSTRAINT "improvement_observations_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_observations"
        ADD CONSTRAINT "improvement_observations_opportunity_id_fk"
        FOREIGN KEY ("opportunity_id") REFERENCES "public"."improvement_opportunities"("id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_hypotheses"
        ADD CONSTRAINT "improvement_hypotheses_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_hypotheses"
        ADD CONSTRAINT "improvement_hypotheses_opportunity_id_fk"
        FOREIGN KEY ("opportunity_id") REFERENCES "public"."improvement_opportunities"("id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "improvement_opportunities_org_status_idx"
    ON "improvement_opportunities" ("organization_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "improvement_opportunities_org_kind_idx"
    ON "improvement_opportunities" ("organization_id", "kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "improvement_opportunities_project_idx"
    ON "improvement_opportunities" ("organization_id", "project_id");--> statement-breakpoint

-- Re-ingesting the same source event is a no-op, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "improvement_observations_opportunity_hash_unique"
    ON "improvement_observations" ("opportunity_id", "content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "improvement_observations_org_source_idx"
    ON "improvement_observations" ("organization_id", "source_type", "source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "improvement_observations_opportunity_idx"
    ON "improvement_observations" ("opportunity_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "improvement_hypotheses_opportunity_idx"
    ON "improvement_hypotheses" ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "improvement_hypotheses_org_idx"
    ON "improvement_hypotheses" ("organization_id");
