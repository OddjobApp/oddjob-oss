-- SaaS connectors become ownable by a project space.
--
-- Until now a connector was org-wide and unique on (org_id, platform), so an
-- organization had exactly one Jira and one Confluence connection. That makes
-- "this project syncs to the ENG space, that one to OPS" unrepresentable — the
-- bound resource lives in `config` (defaultProjectKey / defaultSpace), so a
-- second project could only be served by overwriting the first project's config.
--
-- project_id is nullable and every existing row keeps NULL, which continues to
-- mean org-wide. The uniqueness rule therefore has to split in two: Postgres
-- treats NULLs as distinct in a plain unique index, so a single index over
-- (org_id, project_id, platform) would let an org accumulate unlimited org-wide
-- Jira connectors. Two partial indexes state each rule exactly.

ALTER TABLE saas_connectors
    ADD COLUMN IF NOT EXISTS project_id integer REFERENCES projects(id) ON DELETE CASCADE;

-- The old rule, now restricted to org-wide rows.
DROP INDEX IF EXISTS saas_connector_org_platform_unq;

CREATE UNIQUE INDEX IF NOT EXISTS saas_connector_org_platform_unq
    ON saas_connectors (org_id, platform)
    WHERE project_id IS NULL;

-- One connector per platform per project.
CREATE UNIQUE INDEX IF NOT EXISTS saas_connector_org_project_platform_unq
    ON saas_connectors (org_id, project_id, platform)
    WHERE project_id IS NOT NULL;

-- Listing a project's adapters is the read this surface is built on.
CREATE INDEX IF NOT EXISTS saas_connector_project_idx
    ON saas_connectors (project_id);
