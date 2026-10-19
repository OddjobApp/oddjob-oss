-- Bounded, pre-registered experiments and their computed results.
--
-- The design point worth stating: `improvement_results` keeps MEASUREMENT and
-- INTERPRETATION in separate columns, and the verdict is computed, never
-- authored. `criterion_outcome` and `classification` come from a deterministic
-- service; `interpretation` is model-generated and advisory; `disposition` is
-- the human decision. A model may explain the numbers and may not change them.
--
-- `execution_failure_count` and `policy_stop_count` exist as first-class
-- columns for the same reason: a broken pipeline is not evidence against a
-- hypothesis, and a recovery is not a success. Collapsing either into "failed"
-- is how a good idea gets discarded by a flaky worker.
--
-- Metric values are `integer`, not `numeric`. Drizzle surfaces numeric/decimal
-- as a STRING, which has caused silent comparison bugs here before. Callers
-- carrying fractional metrics should record a fixed-precision unit (e.g.
-- milliseconds, basis points) rather than reintroducing that trap.

CREATE TABLE IF NOT EXISTS "improvement_experiments" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "opportunity_id" integer NOT NULL,
    "hypothesis_id" integer NOT NULL,
    -- draft | pending_approval | approved | running | stopped | completed | abandoned
    "status" text DEFAULT 'draft' NOT NULL,

    "baseline_definition" text NOT NULL,
    "baseline_window_start" timestamp,
    "baseline_window_end" timestamp,

    "intervention" text NOT NULL,
    "control" text,
    "inclusion_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "exclusion_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,

    "starts_at" timestamp,
    "ends_at" timestamp,

    -- { maxCases, maxBudgetUsd, permittedExternalActions, permittedTools, permittedDatasets }
    "boundaries" jsonb,

    "primary_metric" text NOT NULL,
    -- 'increase' | 'decrease'
    "primary_metric_direction" text NOT NULL,
    "minimum_effect" integer DEFAULT 0 NOT NULL,
    -- Below this many usable intervention cases, the result is inconclusive
    -- rather than failed.
    "minimum_sample_size" integer DEFAULT 0 NOT NULL,

    "guardrails" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "stop_conditions" jsonb,
    "rollback_plan" text,

    "required_approver_role" text NOT NULL,
    "approved_by" text,
    "approved_at" timestamp,

    "mission_id" integer,
    "shadow_mission_id" integer,

    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "improvement_results" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "experiment_id" integer NOT NULL,

    "baseline_value" integer,
    "baseline_sample_count" integer DEFAULT 0 NOT NULL,
    "intervention_value" integer,
    "intervention_sample_count" integer DEFAULT 0 NOT NULL,

    -- Data quality is reported, never silently absorbed.
    "missing_record_count" integer DEFAULT 0 NOT NULL,
    "excluded_record_count" integer DEFAULT 0 NOT NULL,
    "exclusion_reasons" jsonb DEFAULT '{}'::jsonb NOT NULL,

    -- Machinery faults, kept out of the hypothesis verdict.
    "execution_failure_count" integer DEFAULT 0 NOT NULL,
    "policy_stop_count" integer DEFAULT 0 NOT NULL,

    "guardrail_results" jsonb DEFAULT '[]'::jsonb NOT NULL,

    -- Computed, not authored: passed | failed | inconclusive | not_run
    "criterion_outcome" text NOT NULL,
    "classification" text NOT NULL,
    "verdict_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,

    -- Model-generated and advisory.
    "interpretation" text,
    "interpretation_citations" jsonb DEFAULT '[]'::jsonb NOT NULL,

    -- The human decision.
    "disposition" text,
    "disposition_rationale" text,
    "disposition_by" text,
    "disposition_at" timestamp,

    "computed_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_experiments"
        ADD CONSTRAINT "improvement_experiments_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_experiments"
        ADD CONSTRAINT "improvement_experiments_opportunity_id_fk"
        FOREIGN KEY ("opportunity_id") REFERENCES "public"."improvement_opportunities"("id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_experiments"
        ADD CONSTRAINT "improvement_experiments_hypothesis_id_fk"
        FOREIGN KEY ("hypothesis_id") REFERENCES "public"."improvement_hypotheses"("id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_results"
        ADD CONSTRAINT "improvement_results_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "improvement_results"
        ADD CONSTRAINT "improvement_results_experiment_id_fk"
        FOREIGN KEY ("experiment_id") REFERENCES "public"."improvement_experiments"("id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "improvement_experiments_org_status_idx"
    ON "improvement_experiments" ("organization_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "improvement_experiments_opportunity_idx"
    ON "improvement_experiments" ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "improvement_results_experiment_idx"
    ON "improvement_results" ("experiment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "improvement_results_org_outcome_idx"
    ON "improvement_results" ("organization_id", "criterion_outcome");
