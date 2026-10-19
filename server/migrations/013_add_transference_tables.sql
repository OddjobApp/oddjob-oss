-- 013_add_transference_tables.sql
-- Migration to support the Transference Engine (TE-101)

CREATE TABLE IF NOT EXISTS ai_execution_logs (
    id SERIAL PRIMARY KEY,
    prompt_hash VARCHAR(32) NOT NULL,
    system_prompt TEXT NOT NULL,
    input_variables JSONB NOT NULL,
    raw_output TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    total_tokens INTEGER,
    organization_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_exec_logs_prompt_hash_idx ON ai_execution_logs(prompt_hash);
CREATE INDEX IF NOT EXISTS ai_exec_logs_org_idx ON ai_execution_logs(organization_id);
CREATE INDEX IF NOT EXISTS ai_exec_logs_created_at_idx ON ai_execution_logs(created_at);

CREATE TABLE IF NOT EXISTS transference_rules (
    id SERIAL PRIMARY KEY,
    prompt_hash VARCHAR(32) UNIQUE NOT NULL,
    system_prompt TEXT NOT NULL,
    mode VARCHAR(20) NOT NULL DEFAULT 'shadow',
    tier INTEGER NOT NULL,
    handler_path TEXT NOT NULL,
    model_path TEXT,
    accuracy_score INTEGER,
    total_shadow_count INTEGER NOT NULL DEFAULT 0,
    mismatch_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transference_rules_prompt_hash_idx ON transference_rules(prompt_hash);
CREATE INDEX IF NOT EXISTS transference_rules_mode_idx ON transference_rules(mode);
