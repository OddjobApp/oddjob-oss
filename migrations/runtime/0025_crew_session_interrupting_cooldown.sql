-- Round cancellation and the per-session round cooldown.
--
-- `interrupting` is the cancel signal: POST /api/crew/:sessionKey/cancel sets
-- it, and the orchestrator reads it between agent turns so it can skip the
-- remaining speakers and finish the round with whatever was produced. It is a
-- column rather than in-process state because the orchestrator and the route
-- that cancels it are not guaranteed to be the same worker.
--
-- `last_round_completed_at` backs the 2-second cooldown that turns a rapid
-- second submission into a 429 instead of a second concurrent round.

ALTER TABLE "crew_sessions" ADD COLUMN IF NOT EXISTS "interrupting" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "crew_sessions" ADD COLUMN IF NOT EXISTS "last_round_completed_at" timestamp;
