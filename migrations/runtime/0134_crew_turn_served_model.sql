-- 0134_crew_turn_served_model
--
-- crew_turns.resolved_model_id records which model row the turn resolved to,
-- but provider failover serves the turn from a different model and that truth
-- was dropped — a turn answered by a local fallback looked identical to one
-- answered by the requested model. served_model/served_provider record what
-- actually answered and was_fallback marks the turn for the UI.
--
-- Idempotent.

ALTER TABLE "crew_turns" ADD COLUMN IF NOT EXISTS "served_model" text;
--> statement-breakpoint
ALTER TABLE "crew_turns" ADD COLUMN IF NOT EXISTS "served_provider" text;
--> statement-breakpoint
ALTER TABLE "crew_turns" ADD COLUMN IF NOT EXISTS "was_fallback" boolean DEFAULT false;
