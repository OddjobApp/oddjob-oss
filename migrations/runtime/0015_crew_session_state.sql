-- CREW session state
--
-- The supervisor's standing read on the room, as opposed to the per-round notes
-- in supervisor_notes. These are "current value" fields the manager rewrites
-- each round, which is why they live on the session rather than accumulating:
--
--   active_topic     what the room is actually working on right now
--   next_steps       what the supervisor says happens next
--   consensus_level  0-100, how close the crew is to agreement
--
-- Idempotent: safe to re-run.

ALTER TABLE "crew_sessions"
  ADD COLUMN IF NOT EXISTS "active_topic" text;
--> statement-breakpoint
ALTER TABLE "crew_sessions"
  ADD COLUMN IF NOT EXISTS "next_steps" text;
--> statement-breakpoint
ALTER TABLE "crew_sessions"
  ADD COLUMN IF NOT EXISTS "consensus_level" integer;
--> statement-breakpoint
ALTER TABLE "crew_sessions"
  ADD CONSTRAINT "crew_sessions_consensus_level_check"
  CHECK ("consensus_level" IS NULL OR ("consensus_level" >= 0 AND "consensus_level" <= 100));
