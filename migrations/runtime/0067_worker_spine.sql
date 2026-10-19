-- Worker heartbeats and the dead-letter queue.
--
-- Both tables are declared in shared/schema/infrastructure/worker-spine.ts and
-- appear in the drizzle snapshots from 0055 onward, but no migration was ever
-- generated for them — they are absent from the runtime baseline too, so they
-- existed in NO environment, including freshly provisioned ones.
--
-- Every worker upserts a heartbeat on a timer and every failure is caught and
-- logged as a warning, which is why the platform looked healthy while the whole
-- worker spine was dark:
--
--   [AIWorker] Heartbeat upsert failed: Failed query: insert into "worker_heartbeats" …
--
-- The dead-letter side is worse than an unreadable dashboard: with no table,
-- exhausted jobs had nowhere to be recorded at all, so adminWorkerService
-- .listUnresolvedDeadLetters() had nothing to list and no DLQ entry was ever
-- written. Written idempotently throughout.

CREATE TABLE IF NOT EXISTS "worker_heartbeats" (
    "id" serial PRIMARY KEY NOT NULL,
    "worker_id" text NOT NULL,
    "worker_type" text NOT NULL,
    "queue_name" text NOT NULL,
    "last_seen" timestamp with time zone DEFAULT now() NOT NULL,
    "jobs_processed" integer DEFAULT 0 NOT NULL,
    "jobs_failed" integer DEFAULT 0 NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb
);

-- worker_id carries .unique() in the schema, and the heartbeat write is an
-- onConflictDoUpdate targeting it — without this constraint every upsert fails.
DO $$ BEGIN
    ALTER TABLE "worker_heartbeats"
        ADD CONSTRAINT "worker_heartbeats_worker_id_unique" UNIQUE ("worker_id");
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN duplicate_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "dead_letter_jobs" (
    "id" serial PRIMARY KEY NOT NULL,
    "queue_name" text NOT NULL,
    "job_name" text NOT NULL,
    "job_data" jsonb,
    "failed_at" timestamp with time zone DEFAULT now() NOT NULL,
    "error" text,
    "attempts" integer DEFAULT 0 NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" text,
    "organization_id" integer,
    "metadata" jsonb DEFAULT '{}'::jsonb
);

-- organization_id is a plain integer in the schema with no .references(), so no
-- foreign key is added here. `orgs` is keyed on org_id rather than id, and
-- migration 0029 was orphaned from the journal for guessing otherwise.

CREATE INDEX IF NOT EXISTS "idx_worker_heartbeats_type"
    ON "worker_heartbeats" ("worker_type");
CREATE INDEX IF NOT EXISTS "idx_worker_heartbeats_last_seen"
    ON "worker_heartbeats" ("last_seen");
CREATE INDEX IF NOT EXISTS "idx_dlq_queue"
    ON "dead_letter_jobs" ("queue_name");
CREATE INDEX IF NOT EXISTS "idx_dlq_failed_at"
    ON "dead_letter_jobs" ("failed_at");
CREATE INDEX IF NOT EXISTS "idx_dlq_resolved"
    ON "dead_letter_jobs" ("resolved_at");
