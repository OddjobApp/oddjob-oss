-- The Transference Engine's two tables.
--
-- `shared/schema/ai/transference.ts` declares both, and no migration ever
-- created either — so they exist in NO environment. The symptom is a warning on
-- effectively every model call:
--
--   [Transference Router] Execution skipped: Error: Failed query:
--   select "id", "prompt_hash", ... from "transference_rules"
--   where "transference_rules"."prompt_hash" = $1 limit $2
--
-- The router fails open, so nothing breaks visibly — which is why this survived.
-- What it costs is the entire feature: no prompt is ever mined into a rule, and
-- no rule can ever shadow or replace an LLM call, so every request pays full
-- model latency and cost regardless of how deterministic it is.
--
-- Both tables are created together because they are two halves of one loop:
-- `ai_execution_logs` is the corpus mined for candidates, `transference_rules`
-- is what mining produces. Creating only the table named in the error would
-- leave the loop with an output and no input.
--
-- Third instance of this class today, after 0049 (project scoping) and 0050
-- (component_index): a schema declaration with no migration behind it, which
-- neither tsc nor any database-mocking test can see.

CREATE TABLE IF NOT EXISTS ai_execution_logs (
  id SERIAL PRIMARY KEY,
  -- md5 of the system prompt; the join key between a logged call and its rule.
  prompt_hash VARCHAR(32) NOT NULL,
  system_prompt TEXT NOT NULL,
  input_variables JSONB NOT NULL,
  raw_output TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  total_tokens INTEGER,
  -- Nullable and unconstrained, matching the declaration: these logs are also
  -- written for platform-level calls that belong to no organisation.
  organization_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_exec_logs_prompt_hash_idx ON ai_execution_logs (prompt_hash);
CREATE INDEX IF NOT EXISTS ai_exec_logs_org_idx ON ai_execution_logs (organization_id);
CREATE INDEX IF NOT EXISTS ai_exec_logs_created_at_idx ON ai_execution_logs (created_at);

CREATE TABLE IF NOT EXISTS transference_rules (
  id SERIAL PRIMARY KEY,
  -- UNIQUE: the router looks a rule up by prompt hash and expects at most one.
  prompt_hash VARCHAR(32) NOT NULL UNIQUE,
  system_prompt TEXT NOT NULL,
  -- 'shadow' | 'active' | 'disabled'. Defaults to shadow so a newly mined rule
  -- runs alongside the model and is measured before it replaces anything.
  mode VARCHAR(20) NOT NULL DEFAULT 'shadow',
  -- 1 = rules/regex, 2 = classic ML, 3 = SLM.
  tier INTEGER NOT NULL,
  handler_path TEXT NOT NULL,
  model_path TEXT,
  accuracy_score INTEGER,
  total_shadow_count INTEGER NOT NULL DEFAULT 0,
  mismatch_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index names match the drizzle declarations, so a later `drizzle-kit push`
-- sees no drift. The unique constraint above already indexes prompt_hash; this
-- mirrors the schema rather than adding capability.
CREATE INDEX IF NOT EXISTS transference_rules_prompt_hash_idx ON transference_rules (prompt_hash);
CREATE INDEX IF NOT EXISTS transference_rules_mode_idx ON transference_rules (mode);
