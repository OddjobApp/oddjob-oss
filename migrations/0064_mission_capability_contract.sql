-- Mission capability contract: structured self-description (purpose/whenToUse/
-- inputs/outputs) that powers agent capability discovery (discover_capabilities).
-- Auto-backfilled from mission description via LLM; safe/idempotent.
ALTER TABLE "missions" ADD COLUMN IF NOT EXISTS "capability_contract" jsonb;
