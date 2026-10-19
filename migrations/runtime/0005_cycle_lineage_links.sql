-- Cycle lineage links + hot-path indexes.
--
-- Backfills the Drizzle schema changes committed in 04324a38 ("instant app
-- framework"), which added columns and indexes to shared/schema without a
-- corresponding migration, leaving the schema drifted from the database.
--
-- Idempotent: safe to re-run.

-- Dataset lineage: which operational cycle produced this dataset.
-- Mirrors the existing datasets.mission_id link.
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS cycle_id INTEGER;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_datasets_cycle ON datasets (cycle_id);
--> statement-breakpoint

-- Job collection lineage: optional link back to an operational cycle.
-- Mirrors the existing job_collections.mission_id link (also unconstrained).
ALTER TABLE job_collections ADD COLUMN IF NOT EXISTS cycle_id INTEGER;
--> statement-breakpoint

-- Supports the org + type + active form-agent lookup on the chat hot path
-- (resolveFormAgentForm in server/domain/agents/agent.service.ts).
CREATE INDEX IF NOT EXISTS idx_jobs_org_type_active
  ON jobs (organization_id, type, is_active);
--> statement-breakpoint

-- Supports per-run event timelines ordered by time in the cycle run views.
CREATE INDEX IF NOT EXISTS idx_cycle_run_events_run_timestamp
  ON cycle_run_events (run_id, "timestamp");
--> statement-breakpoint

-- Rollback:
--   DROP INDEX IF EXISTS idx_cycle_run_events_run_timestamp;
--   DROP INDEX IF EXISTS idx_jobs_org_type_active;
--   ALTER TABLE job_collections DROP COLUMN IF EXISTS cycle_id;
--   DROP INDEX IF EXISTS idx_datasets_cycle;
--   ALTER TABLE datasets DROP COLUMN IF EXISTS cycle_id;
