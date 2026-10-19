-- Record which tools an agent actually called while producing a turn.
--
-- Tier 1 gives crew agents READ-ONLY tools so they can cite evidence instead of
-- speculating. Storing the calls on the turn makes that auditable, and lets the
-- room show what an agent actually did rather than just what it said.
--
-- Shape: [{ "name": "github_list_prs", "ok": true, "ms": 412 }]
--
-- Idempotent: safe to re-run.

ALTER TABLE "crew_turns"
  ADD COLUMN IF NOT EXISTS "tools_used" jsonb DEFAULT '[]'::jsonb NOT NULL;
