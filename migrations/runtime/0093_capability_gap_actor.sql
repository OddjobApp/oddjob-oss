-- Adds the actor dimension to capability-gap telemetry.
--
-- §6.3's priority score has a `user_impact_score` term built on
-- `unique_affected_users`. Migration 0089 recorded the run but not who was
-- acting in it, so that term was uncomputable — the score would have had to
-- either omit it or silently treat every gap as affecting one user.
--
-- Hashed, not stored plainly. §14 defaults this analysis to hashed actor
-- identifiers: counting DISTINCT affected people needs a stable key, and needs
-- nothing else about them. A hash gives the count without turning capability
-- telemetry into a record of who failed to do what.
--
-- Nullable: a gap raised by a scheduled job or a system agent genuinely has no
-- user behind it, and that is a different fact from an unrecorded one. NULL is
-- excluded from the distinct-user count rather than counted as an anonymous
-- extra person.

ALTER TABLE "capability_gap_events"
    ADD COLUMN IF NOT EXISTS "actor_user_hash" text;--> statement-breakpoint

-- The distinct-user count is per organization and tool.
CREATE INDEX IF NOT EXISTS "capability_gap_events_org_tool_actor_idx"
    ON "capability_gap_events" ("organization_id", "requested_tool_name", "actor_user_hash");
