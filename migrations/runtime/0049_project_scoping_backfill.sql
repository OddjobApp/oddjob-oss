-- Project-scoping columns the schema declares but no migration ever created.
--
-- `apps`, `app_deployments` and `knowledge_topics` carry `projectId` in the
-- drizzle schema, and drizzle SELECTs every declared column — so every query
-- against those tables failed with "column does not exist" in EVERY
-- environment, development and test alike. Symptom seen in the wild:
--
--   Graph build error: Failed query: select "id", "name", "slug", ...,
--   "project_id", ... from "apps" where "apps"."slug" = $1
--
-- This is a different class of drift from a database being behind the chain:
-- these columns were added to the schema during Project Spaces without a
-- corresponding migration, so no environment has ever had them. Adding them
-- here rather than to 0006 because 0006 is already applied everywhere.
--
-- Nullable and unconstrained, matching the declarations exactly:
-- `apps.projectId` and `app_deployments.projectId` are plain integers with no
-- FK (unlike datasets/knowledge_base/operational_cycles, which do reference
-- projects). `knowledge_topics.projectId` DOES declare the FK, so it gets one.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS project_id integer;
ALTER TABLE app_deployments ADD COLUMN IF NOT EXISTS project_id integer;
ALTER TABLE knowledge_topics ADD COLUMN IF NOT EXISTS project_id integer;

-- knowledge_topics.projectId declares `.references(() => projects.id,
-- { onDelete: "set null" })`. Added only when the projects table exists, so
-- this migration stays applicable to databases that have not reached 0006.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'projects')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'knowledge_topics_project_id_projects_id_fk') THEN
    ALTER TABLE knowledge_topics
      ADD CONSTRAINT knowledge_topics_project_id_projects_id_fk
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Scoped reads filter on (organization_id, project_id); these are the lookups
-- `withProjectScope()` performs on every request.
CREATE INDEX IF NOT EXISTS idx_apps_project ON apps (organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_topics_project ON knowledge_topics (project_id);
