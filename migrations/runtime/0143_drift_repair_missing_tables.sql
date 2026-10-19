-- 0143_drift_repair_missing_tables
--
-- DRIFT REPAIR: four more tables declared in shared/schema with no CREATE TABLE
-- anywhere in the runtime chain. Same class of failure as
-- 0077_drift_repair_baselined_tables.sql and 0142_forge_releases.sql.
--
--   products, quotes
--     Declared in shared/schema/product.ts and quote.ts. Their only DDL lives in
--     legacy migrations/0062_schema_relationship_gaps.sql, which the runtime
--     migrator does not read — a database built purely from this chain lacks
--     them.
--
--   hermes_traces
--     Declared in shared/schema/gms/hermes-traces.ts; written by
--     server/core/gms/hermes/trace-collector.ts. No SQL anywhere.
--
--   prediction_outcomes
--     Declared in shared/schema/prediction/prediction-outcomes.ts. No SQL
--     anywhere.
--
-- Definitions are copied from the drizzle snapshot (migrations/meta/
-- 0066_snapshot.json) so the result matches what drizzle-kit would emit, and
-- everything is guarded — environments that already have these tables (e.g.
-- via push or the legacy chain) are left unchanged.

-- ── hermes_traces ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hermes_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"trace_id" varchar(64) NOT NULL,
	"mission_id" integer,
	"job_id" integer,
	"execution_id" integer,
	"agent_id" varchar(64),
	"organization_id" integer NOT NULL,
	"user_id" varchar(64),
	"thought_content" text NOT NULL,
	"tool_calls" jsonb NOT NULL,
	"tool_results" jsonb,
	"final_content" text,
	"trace_steps" jsonb NOT NULL,
	"embedding" jsonb,
	"predicted_outcome" real,
	"actual_outcome" boolean,
	"execution_time" integer,
	"token_usage" jsonb,
	"model_used" varchar(64),
	"reasoning_protocol" varchar(32) DEFAULT 'hermes_xml' NOT NULL,
	"is_shadow_run" boolean DEFAULT false NOT NULL,
	"shadow_config" jsonb,
	"skill_id" varchar(64),
	"generation" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hermes_traces_trace_id_unique" UNIQUE("trace_id")
);

-- ── prediction_outcomes ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "prediction_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_run_id" integer NOT NULL,
	"cycle" integer NOT NULL,
	"predicted_tool" text,
	"actual_tool" text NOT NULL,
	"was_correct" boolean DEFAULT false NOT NULL,
	"confidence" double precision,
	"organization_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_prediction_outcomes_run" ON "prediction_outcomes" ("mission_run_id");
CREATE INDEX IF NOT EXISTS "idx_prediction_outcomes_org" ON "prediction_outcomes" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_prediction_outcomes_created" ON "prediction_outcomes" ("created_at");

-- ── products ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"options" jsonb NOT NULL
);

-- ── quotes ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_number" text NOT NULL,
	"opportunity_id" integer,
	"line_items" jsonb NOT NULL
);

-- ── Foreign keys ─────────────────────────────────────────────
-- ADD CONSTRAINT has no IF NOT EXISTS, so each is guarded.
DO $$ BEGIN
  BEGIN
    ALTER TABLE "hermes_traces" ADD CONSTRAINT "hermes_traces_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
