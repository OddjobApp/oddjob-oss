-- Durable confirmation counters for the spatial iteration gate.
--
-- The gate requires N consecutive confirmations before a spatial condition
-- reports true, and M misses before a latched one releases. Held only in
-- memory, that state is correct within a single process lifetime: a restart
-- drops a LATCHED geofence back to unconfirmed, so an asset already sitting
-- inside a zone re-fires ON_ENTER after every deploy — a duplicate alert for an
-- entry that already happened, and precisely the boundary noise the gate exists
-- to suppress.
--
-- One row per (organization, condition, subject). The engine uses this as a
-- write-behind cache — hydrate before evaluating, flush after — so the hot path
-- stays an in-memory map lookup rather than a query per condition.

CREATE TABLE IF NOT EXISTS "spatial_condition_state" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "condition_key" text NOT NULL,
  -- "__global__" for feeds that carry no subject; a real id otherwise, so two
  -- vessels confirm their transitions independently.
  "subject_id" text NOT NULL,
  "hits" integer NOT NULL DEFAULT 0,
  "misses" integer NOT NULL DEFAULT 0,
  "latched" boolean NOT NULL DEFAULT false,
  "last_seen_at" timestamp DEFAULT now() NOT NULL
);

-- The engine reads and upserts by this triple on every evaluation, and the
-- uniqueness is what makes the upsert idempotent under concurrent consumers.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_spatial_condition_state_key"
  ON "spatial_condition_state" ("organization_id", "condition_key", "subject_id");

-- Supports pruning subjects that have stopped reporting.
CREATE INDEX IF NOT EXISTS "idx_spatial_condition_state_stale"
  ON "spatial_condition_state" ("last_seen_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'spatial_condition_state_organization_id_fkey'
  ) THEN
    ALTER TABLE "spatial_condition_state"
      ADD CONSTRAINT "spatial_condition_state_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id") ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Skipped spatial_condition_state org FK: %', SQLERRM;
END $$;
