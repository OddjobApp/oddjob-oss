-- Recurring project timeline events.
--
-- Occurrences are deliberately NOT stored. A weekly review for a year is one
-- row and 52 derived dates; materialising them would mean a row explosion, an
-- arbitrary horizon to pick, and a backfill every time someone edits the rule.
-- The read path expands within the window being viewed, which is how the
-- scheduler already treats cycles.

ALTER TABLE "project_events" ADD COLUMN IF NOT EXISTS "recurrence" text;
--> statement-breakpoint
ALTER TABLE "project_events" ADD COLUMN IF NOT EXISTS "recurrence_timezone" text DEFAULT 'UTC' NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_events" ADD COLUMN IF NOT EXISTS "recurrence_until" timestamp;
