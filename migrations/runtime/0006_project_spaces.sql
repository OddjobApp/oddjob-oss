-- Project Spaces — Phase 1 (data model, no user-visible change).
--
-- Adds the durable scope between orgs (tenant) and operational_cycles (iteration):
-- three new tables plus ONE new column. Resources attach through the
-- project_resources junction rather than a project_id column per table — see
-- docs/PROJECT_SPACES_DESIGN.md §5.2. The 52 existing mission_id/cycle_id columns
-- are deliberately left untouched; they stay as execution lineage (§3).
--
-- Idempotent: safe to re-run.
-- Reversible: the rollback block at the foot of this file restores the prior system
-- exactly — nothing existing is deleted or rewritten.

CREATE TABLE IF NOT EXISTS projects (
  id                SERIAL PRIMARY KEY,
  organization_id   INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  key               TEXT NOT NULL,
  name              TEXT NOT NULL,
  objective         TEXT,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  visibility        TEXT NOT NULL DEFAULT 'org',
  owner_user_id     TEXT,
  budget_limit_usd  NUMERIC(12,2),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_at       TIMESTAMP
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS projects_org_key_unique
  ON projects (organization_id, key);
--> statement-breakpoint

-- At most one default project per org. Everything unassigned lands in it, which is
-- what keeps scope queries total and avoids a null-scope branch everywhere.
CREATE UNIQUE INDEX IF NOT EXISTS projects_org_default_unique
  ON projects (organization_id) WHERE is_default;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS projects_org_status_idx
  ON projects (organization_id, status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS project_members (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL,
  principal_id   TEXT NOT NULL,
  role           TEXT NOT NULL,
  added_by       TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS project_members_unique
  ON project_members (project_id, principal_type, principal_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS project_members_principal_idx
  ON project_members (principal_type, principal_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS project_resources (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_id   INTEGER NOT NULL,
  relation      TEXT NOT NULL DEFAULT 'primary',
  added_by      TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS project_resources_unique
  ON project_resources (project_id, resource_type, resource_id);
--> statement-breakpoint

-- "One home per resource": a resource has exactly one primary project, but may be
-- referenced by any number of others.
CREATE UNIQUE INDEX IF NOT EXISTS project_resources_primary_unique
  ON project_resources (resource_type, resource_id) WHERE relation = 'primary';
--> statement-breakpoint

-- Reverse lookup (resource -> project) behind the scope resolver's LRU cache.
CREATE INDEX IF NOT EXISTS project_resources_lookup
  ON project_resources (resource_type, resource_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS project_resources_by_project
  ON project_resources (project_id, resource_type);
--> statement-breakpoint

-- The one narrow exception to the junction (§5.3). ON DELETE SET NULL so removing a
-- project never destroys execution history.
ALTER TABLE operational_cycles
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_operational_cycles_project
  ON operational_cycles (project_id);
--> statement-breakpoint

-- Rollback:
--   ALTER TABLE operational_cycles DROP COLUMN IF EXISTS project_id;
--   DROP TABLE IF EXISTS project_resources;
--   DROP TABLE IF EXISTS project_members;
--   DROP TABLE IF EXISTS projects;
