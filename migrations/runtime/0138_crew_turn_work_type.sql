-- 0138_crew_turn_work_type
--
-- Work-type rollup for crew turns: each turn is classified at post time into
-- a coarse category (inbox, engineering, research, support, ...) so analytics
-- can answer "what kind of work are the agents doing" from a column instead
-- of re-classifying prose. Tools are the signal — a turn is what it executed,
-- not what it claimed.
--
-- Idempotent.

ALTER TABLE "crew_turns"
	ADD COLUMN IF NOT EXISTS "work_type" text;
