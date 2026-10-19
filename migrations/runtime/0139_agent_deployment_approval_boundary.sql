-- 0139_agent_deployment_approval_boundary
--
-- Same durable send rules agent cards carry, for deployed (job-backed) agents.
-- Mission-executed agents — e.g. heartbeat standing agents — don't go through
-- a crew room, so their boundary lives on the deployment and the outbound send
-- gate resolves it via the executing job. Idempotent.

ALTER TABLE "agent_deployments"
	ADD COLUMN IF NOT EXISTS "approval_boundary" text;
