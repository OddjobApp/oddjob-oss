-- Migration 008: Add deployment_profile to org_settings
-- Purpose: Hardware-aware deployment profiles control parallelism, context-length,
--          and feature flags based on the org's hardware tier.
--
-- Profiles:
--   laptop      - 8-16 GB RAM, single GPU optional (dev / trial)
--   workstation - 32-64 GB RAM, 1-2 GPUs (power-user / team)
--   server      - 64-256 GB RAM, 2-8 GPUs (on-prem server)
--   cluster     - Multi-node GPU cluster / cloud-burst (enterprise)
--
-- The profile drives auto-tuning of:
--   - missionConcurrency cap
--   - default maxTokens per request
--   - local model enablement
--   - streaming batch sizes

ALTER TABLE org_settings
    ADD COLUMN IF NOT EXISTS deployment_profile TEXT NOT NULL DEFAULT 'laptop'
        CHECK (deployment_profile IN ('laptop', 'workstation', 'server', 'cluster'));

-- Store any custom profile overrides as a JSONB blob
ALTER TABLE org_settings
    ADD COLUMN IF NOT EXISTS deployment_profile_overrides JSONB DEFAULT '{}'::jsonb;

ANALYZE org_settings;
