CREATE TABLE IF NOT EXISTS cycle_builder_drafts (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'blank',
  source_id TEXT,
  schema_version TEXT NOT NULL,
  definition JSONB NOT NULL,
  validation_state TEXT NOT NULL DEFAULT 'unchecked',
  version INTEGER NOT NULL DEFAULT 1,
  created_cycle_id INTEGER,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cycle_builder_drafts_org_updated_idx ON cycle_builder_drafts (organization_id, updated_at);
CREATE INDEX IF NOT EXISTS cycle_builder_drafts_owner_updated_idx ON cycle_builder_drafts (owner_user_id, updated_at);

-- Rollback: DROP TABLE IF EXISTS cycle_builder_drafts;
