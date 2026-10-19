-- Migration 012: Reusable agent policy bundles.
-- Bundles provide named grant templates that can be applied to agent identities.

CREATE TABLE IF NOT EXISTS agent_policy_bundles (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    risk_level      TEXT NOT NULL DEFAULT 'medium',
    grants          JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_agent_policy_bundles_org    ON agent_policy_bundles(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_policy_bundles_status ON agent_policy_bundles(status);
