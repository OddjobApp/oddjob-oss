-- Migration 010: Agent identity, permission, credential lease, and governance audit primitives.
-- Establishes agents as first-class IAM-style principals for policy decisions.

CREATE TABLE IF NOT EXISTS agent_identities (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id   INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    agent_id          TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    owner_id          TEXT NOT NULL,
    environment       TEXT NOT NULL DEFAULT 'dev',
    status            TEXT NOT NULL DEFAULT 'draft',
    risk_level        TEXT NOT NULL DEFAULT 'medium',
    policy_bundle_id  TEXT,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by        TEXT NOT NULL,
    last_reviewed_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, agent_id, environment)
);

CREATE INDEX IF NOT EXISTS idx_agent_identities_org    ON agent_identities(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_identities_agent  ON agent_identities(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_identities_status ON agent_identities(status);

CREATE TABLE IF NOT EXISTS agent_permission_grants (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id     INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    agent_identity_id   TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    tool                TEXT NOT NULL,
    action              TEXT NOT NULL,
    resource            TEXT NOT NULL DEFAULT '*',
    effect              TEXT NOT NULL DEFAULT 'allow',
    requires_approval   BOOLEAN NOT NULL DEFAULT FALSE,
    conditions          JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at          TIMESTAMPTZ,
    created_by          TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_permission_grants_org         ON agent_permission_grants(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_permission_grants_identity    ON agent_permission_grants(agent_identity_id);
CREATE INDEX IF NOT EXISTS idx_agent_permission_grants_tool_action ON agent_permission_grants(tool, action);

CREATE TABLE IF NOT EXISTS agent_credential_leases (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id     INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    agent_identity_id   TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    credential_id       INTEGER NOT NULL,
    tool                TEXT NOT NULL,
    action              TEXT NOT NULL,
    resource            TEXT NOT NULL DEFAULT '*',
    status              TEXT NOT NULL DEFAULT 'active',
    lease_reason        TEXT,
    issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_credential_leases_org      ON agent_credential_leases(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_credential_leases_identity ON agent_credential_leases(agent_identity_id);
CREATE INDEX IF NOT EXISTS idx_agent_credential_leases_status   ON agent_credential_leases(status);
CREATE INDEX IF NOT EXISTS idx_agent_credential_leases_expires  ON agent_credential_leases(expires_at);

CREATE TABLE IF NOT EXISTS agent_governance_audit_events (
    id                  SERIAL PRIMARY KEY,
    organization_id     INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    agent_identity_id   TEXT REFERENCES agent_identities(id) ON DELETE SET NULL,
    agent_id            TEXT NOT NULL,
    run_id              TEXT,
    initiated_by        TEXT,
    tool                TEXT NOT NULL,
    action              TEXT NOT NULL,
    resource            TEXT NOT NULL DEFAULT '*',
    decision            TEXT NOT NULL,
    risk_level          TEXT NOT NULL DEFAULT 'low',
    policy_codes        TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    input_hash          TEXT,
    output_hash         TEXT,
    status              TEXT NOT NULL DEFAULT 'recorded',
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_gov_audit_org      ON agent_governance_audit_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_gov_audit_agent    ON agent_governance_audit_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_gov_audit_decision ON agent_governance_audit_events(decision);
CREATE INDEX IF NOT EXISTS idx_agent_gov_audit_created  ON agent_governance_audit_events(created_at);
