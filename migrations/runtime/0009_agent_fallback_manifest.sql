-- Agent fallbacks — limp mode.
--
-- Every agent deployment gains a manifest of deterministic routes it can serve
-- with no model call. The platform derives this at synthesis/deploy time from
-- what the agent already declares (formManifest, allowedPipelineIds,
-- allowedTools), so a fallback is a property of *being an agent* rather than
-- something each surface hardcodes.
--
-- Why this column and not a lookup table: the manifest is a derived cache with
-- exactly one owner (the deployment) and is rewritten wholesale on every
-- deploy — the same shape and lifecycle as form_manifest, which sits inline for
-- the same reason. There is nothing to join to and no partial update to make.
--
-- Backfill: '{}'::jsonb, which AgentFallbackService treats as "not yet derived"
-- and regenerates on next deploy. The backfill script
-- (server/scripts/backfill-agent-fallbacks.ts) populates existing rows without
-- waiting for a redeploy.
--
-- Idempotent: safe to re-run.

ALTER TABLE agent_deployments
  ADD COLUMN IF NOT EXISTS fallback_manifest JSONB DEFAULT '{}'::jsonb;
--> statement-breakpoint

-- Partial index over agents that have NOT yet been given a manifest, so the
-- backfill and the compliance check can find stragglers without a seq scan as
-- the deployment count grows.
CREATE INDEX IF NOT EXISTS agent_deployments_missing_fallback_idx
  ON agent_deployments (id)
  WHERE fallback_manifest IS NULL OR fallback_manifest = '{}'::jsonb;
