-- Repair `scoring_events`, then index it for the decayed S.C.O.R.E. rebuild.
--
-- DRIFT REPAIR: the baseline (20260717213750_baseline.sql:4258) creates this
-- table, but it is absent from at least one environment while its siblings
-- `scoring_rules` and `score_thresholds` are present — consistent with the
-- database having been baselined (migrations marked applied without being
-- executed) against a snapshot that predated the table.
--
-- The consequence is silent: scoring.service.ts inserts a row here on every
-- rule match, that insert throws "relation does not exist", and the surrounding
-- try/catch swallows it and returns null — so the lead is never scored and no
-- intervention ever fires. Nothing surfaces except a log line.
--
-- Definition copied verbatim from the baseline so environments that already
-- have the table are unaffected.

CREATE TABLE IF NOT EXISTS "scoring_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"event_type" text NOT NULL,
	"rule_id" integer,
	"threshold_id" integer,
	"prospect_id" integer,
	"action_type" text NOT NULL,
	"action_config" jsonb,
	"vector_state" jsonb,
	"confidence" real,
	"location" text,
	"mission_run_id" integer,
	"agent_deployment_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scoring_run" ON "scoring_events" USING btree ("mission_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scoring_agent" ON "scoring_events" USING btree ("agent_deployment_id");
--> statement-breakpoint
-- The decayed vector is rebuilt from contribution history on every scored
-- event, filtering by prospect over a recent createdAt window. Without this the
-- rebuild is a sequential scan on the ingest hot path (worker concurrency 20).
CREATE INDEX IF NOT EXISTS "idx_scoring_prospect_time"
  ON "scoring_events" USING btree ("prospect_id", "created_at");
