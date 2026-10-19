-- CREW breakouts, meeting schedules, and the crew_sessions cycle/breakout columns.
--
-- These objects are declared in shared/schema/crew.ts but no migration ever
-- created them, so tsc and the unit suites stay green while every reader and
-- writer -- crew-meeting-scheduler.service.ts, crew-cycle-bridge.service.ts,
-- crew-orchestrator.service.ts and the crew routes -- fails against a real
-- database with "relation does not exist" / "column does not exist".
--
-- Same defect class as 0106_competencies: schema declared, migration never
-- written. Written idempotently so it is a no-op where it has been hand-applied.

ALTER TABLE "crew_sessions" ADD COLUMN IF NOT EXISTS "cycle_slug" text;--> statement-breakpoint
ALTER TABLE "crew_sessions" ADD COLUMN IF NOT EXISTS "cycle_stage_id" text;--> statement-breakpoint
ALTER TABLE "crew_sessions" ADD COLUMN IF NOT EXISTS "cycle_context" jsonb;--> statement-breakpoint
ALTER TABLE "crew_sessions" ADD COLUMN IF NOT EXISTS "parent_session_id" integer;--> statement-breakpoint

-- Self-referencing FK: a breakout room points at the room that spawned it.
-- ON DELETE SET NULL, so deleting a parent orphans rather than cascades.
DO $$ BEGIN
    ALTER TABLE "crew_sessions"
        ADD CONSTRAINT "crew_sessions_parent_session_id_fk"
        FOREIGN KEY ("parent_session_id") REFERENCES "crew_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_crew_sessions_parent" ON "crew_sessions" ("parent_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crew_sessions_cycle" ON "crew_sessions" ("organization_id","cycle_slug");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "crew_breakouts" (
    "id" serial PRIMARY KEY NOT NULL,
    "parent_session_id" integer NOT NULL REFERENCES "crew_sessions"("id") ON DELETE CASCADE,
    "child_session_id" integer NOT NULL REFERENCES "crew_sessions"("id") ON DELETE CASCADE,
    "sub_topic" text NOT NULL,
    "suggested_by" text DEFAULT 'Supervisor' NOT NULL,
    "created_at" timestamp DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_crew_breakouts_parent" ON "crew_breakouts" ("parent_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crew_breakouts_child" ON "crew_breakouts" ("child_session_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "crew_meeting_schedules" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "project_id" integer,
    "title" text NOT NULL,
    "agenda" text,
    "status" text DEFAULT 'proposed' NOT NULL,
    "host_user_id" text NOT NULL,
    "candidate_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "confirmed_slot" jsonb,
    "requested_attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_session_key" text,
    "reminder_minutes_before" integer DEFAULT 15,
    "bullmq_job_id" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_crew_meeting_schedules_org" ON "crew_meeting_schedules" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crew_meeting_schedules_project" ON "crew_meeting_schedules" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crew_meeting_schedules_status" ON "crew_meeting_schedules" ("status");
