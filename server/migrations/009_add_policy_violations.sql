-- Migration 009: Policy Violation Log
-- Tracks every capability policy check that resulted in a violation
-- (either blocked in strict mode or warned in warn/log mode).

CREATE TABLE IF NOT EXISTS policy_violations (
    id            BIGSERIAL PRIMARY KEY,
    organization_id INTEGER      NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    -- Who was doing the action
    user_id       INTEGER,
    agent_id      TEXT,
    role          TEXT          NOT NULL,
    -- What was denied
    check_type    TEXT          NOT NULL,   -- 'tool' | 'filePath' | 'network' | 'model'
    check_value   TEXT          NOT NULL,   -- the tool name, path, hostname, or model name
    enforcement   TEXT          NOT NULL,   -- 'strict' | 'warn' | 'log'
    -- Context
    mission_id    INTEGER,
    pipeline_id   INTEGER,
    job_id        INTEGER,
    -- Outcome
    blocked       BOOLEAN       NOT NULL DEFAULT FALSE, -- true = request was blocked
    resolved      BOOLEAN       NOT NULL DEFAULT FALSE, -- true = admin acknowledged
    -- Timestamp
    occurred_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_violations_org         ON policy_violations(organization_id);
CREATE INDEX IF NOT EXISTS idx_policy_violations_occurred_at ON policy_violations(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_violations_check_type  ON policy_violations(check_type);
CREATE INDEX IF NOT EXISTS idx_policy_violations_blocked     ON policy_violations(blocked) WHERE blocked = true;
