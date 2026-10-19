-- 0123_media_shot_timeline_edits
--
-- The timeline sequencer can trim a shot, hold its last frame, move it onto an
-- overlay track and set how long a transition runs. None of it had anywhere to
-- live: every edit changed React state, the PATCH that carried a transition
-- length was silently stripped by a non-strict schema, and the reel was cut from
-- the untrimmed takes. The edits looked applied until the page was reloaded.
--
-- Seconds are `real`, not `numeric`: drizzle reads numeric back as a STRING, and
-- every reader here does arithmetic on these. Whole seconds would be wrong too —
-- a trim lands on a frame, which at 24fps is a fraction.
--
-- Defaults match what the code assumed while these were absent, so a shot that
-- predates this migration reads exactly as it did before:
--   track 1 (the primary magnetic track), no trim, no hold, no start override,
--   and a transition that runs for its own standard length.
--
-- Idempotent.

ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "track" integer NOT NULL DEFAULT 1;
ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "start_time_seconds" real;
ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "trim_in_seconds" real;
ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "trim_out_seconds" real;
ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "hold_duration_seconds" real;
ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "transition_duration_seconds" real;

-- An overlay is the only kind of shot that carries its own start time; a V1 shot
-- follows the one before it, and a stored offset would be a second answer to the
-- same question, free to disagree.
DO $$ BEGIN
	ALTER TABLE "media_shots" ADD CONSTRAINT "media_shots_track_check" CHECK ("track" IN (1, 2));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "media_shots" ADD CONSTRAINT "media_shots_trim_order_check" CHECK (
		"trim_in_seconds" IS NULL OR "trim_out_seconds" IS NULL OR "trim_out_seconds" > "trim_in_seconds"
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "media_shots" ADD CONSTRAINT "media_shots_timeline_non_negative_check" CHECK (
		coalesce("start_time_seconds", 0) >= 0
		AND coalesce("trim_in_seconds", 0) >= 0
		AND coalesce("hold_duration_seconds", 0) >= 0
		AND coalesce("transition_duration_seconds", 0) >= 0
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
