-- Eval Measurement Spine — persisted eval history (Phase 00).
-- The trust currency the autonomy ladder queries. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "eval_runs" (
    "id" serial PRIMARY KEY NOT NULL,
    "commit_sha" text,
    "suite" text DEFAULT 'scenarios' NOT NULL,
    "model" text,
    "total_scenarios" integer DEFAULT 0 NOT NULL,
    "passed_scenarios" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp DEFAULT now() NOT NULL,
    "finished_at" timestamp,
    "meta" jsonb
);

CREATE TABLE IF NOT EXISTS "eval_results" (
    "id" serial PRIMARY KEY NOT NULL,
    "run_id" integer NOT NULL,
    "subject_kind" text NOT NULL,
    "subject_ref" text NOT NULL,
    "subject_key" text NOT NULL,
    "scenario_id" text NOT NULL,
    "pass_rate" numeric(5, 4) NOT NULL,
    "threshold" numeric(5, 4) NOT NULL,
    "passed" boolean NOT NULL,
    "repeats" integer DEFAULT 1 NOT NULL,
    "variance" numeric(6, 5) DEFAULT '0' NOT NULL,
    "criteria" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE "eval_results"
        ADD CONSTRAINT "eval_results_run_id_eval_runs_id_fk"
        FOREIGN KEY ("run_id") REFERENCES "eval_runs"("id")
        ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "eval_results_subject_idx"
    ON "eval_results" ("subject_key", "created_at");
CREATE INDEX IF NOT EXISTS "eval_results_run_idx"
    ON "eval_results" ("run_id");
