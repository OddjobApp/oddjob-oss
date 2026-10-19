-- Durable, org-scoped state for multi-step assembly runs.
--
-- BlueprintStateService kept sessions in an in-process Map: a restart dropped
-- every in-flight run, the worker fleet could not see any of them, and there was
-- no organization on a session at all — holding an id was sufficient to read or
-- advance another tenant's run. Stage prerequisites are enforced server-side, so
-- this is the authoritative copy; the client renders it and does not keep its own.

CREATE TABLE IF NOT EXISTS blueprint_sessions (
    id text PRIMARY KEY,
    org_id integer NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,

    blueprint_id text NOT NULL,

    -- A snapshot, deliberately. A run must not change shape underneath the person
    -- walking through it because the source blueprint was edited mid-session.
    blueprint jsonb NOT NULL,

    verified_stage_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    active_stage_id text,
    stage_configs jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_by text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS blueprint_sessions_org_idx ON blueprint_sessions (org_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS blueprint_sessions_org_blueprint_idx ON blueprint_sessions (org_id, blueprint_id);
