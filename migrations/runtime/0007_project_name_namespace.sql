-- Project Spaces — identity namespace.
--
-- Makes the project a real NAMESPACE for resource names, not just a container:
-- dataset names and knowledge-document titles become unique WITHIN a project instead
-- of within the org, so two projects can each own a "Fleet Telemetry" dataset.
--
-- Why a real project_id column here, when PROJECT_SPACES_DESIGN §5.2 routes
-- containment through the project_resources junction: Postgres cannot enforce a
-- uniqueness constraint across a junction. Namespacing REQUIRES the key to sit on the
-- row being constrained. This is the same reasoning that already earned
-- operational_cycles its own column in §5.3, applied to the two tables whose names are
-- user-facing and already carried an org-level unique index.
--
-- Deliberately NOT namespaced:
--   apps        — app slugs are globally unique because they must be DNS-safe for
--                 in-platform launch routing; scoping them per project would break it.
--   missions    — no name uniqueness constraint exists today, so there is nothing to
--                 namespace, and adding one would reject data that is legal now.
--
-- Widening only: (organization_id, name) unique -> (project_id, name) unique is
-- strictly more permissive for existing rows, because every row backfills into exactly
-- one project and a project belongs to exactly one org. No existing row can conflict.
--
-- Idempotent: safe to re-run.

ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
--> statement-breakpoint

-- Backfill from the containment junction that 0006 already populated.
UPDATE datasets d
SET project_id = pr.project_id
FROM project_resources pr
WHERE pr.resource_type = 'dataset'
  AND pr.resource_id = d.id
  AND pr.relation = 'primary'
  AND d.project_id IS NULL;
--> statement-breakpoint

UPDATE knowledge_documents kd
SET project_id = pr.project_id
FROM project_resources pr
WHERE pr.resource_type = 'kb_document'
  AND pr.resource_id = kd.id
  AND pr.relation = 'primary'
  AND kd.project_id IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_datasets_project ON datasets (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_docs_project_idx ON knowledge_documents (project_id);
--> statement-breakpoint

-- The namespaced constraints. Plain (not partial) indexes so ON CONFLICT can target
-- them directly: the ingest paths in knowledge.service.ts and document-service.ts
-- upsert on this exact column pair.
CREATE UNIQUE INDEX IF NOT EXISTS datasets_project_name_unique
  ON datasets (project_id, name);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_docs_project_title_unique
  ON knowledge_documents (project_id, title);
--> statement-breakpoint

-- Postgres treats NULLs as distinct, so a row with no project would escape the index
-- above. Services always resolve a project (falling back to the org default), but these
-- partial indexes preserve the OLD org-level guarantee for any row that slips through.
CREATE UNIQUE INDEX IF NOT EXISTS datasets_org_name_unique_unassigned
  ON datasets (organization_id, name) WHERE project_id IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_docs_org_title_unique_unassigned
  ON knowledge_documents (organization_id, title) WHERE project_id IS NULL;
--> statement-breakpoint

-- Only now drop the org-wide constraints these replace.
DROP INDEX IF EXISTS datasets_org_name_unique;
--> statement-breakpoint
DROP INDEX IF EXISTS knowledge_docs_org_title_unique;
--> statement-breakpoint

-- Rollback:
--   CREATE UNIQUE INDEX "datasets_org_name_unique" ON datasets (organization_id, name);
--   CREATE UNIQUE INDEX "knowledge_docs_org_title_unique" ON knowledge_documents (organization_id, title);
--   DROP INDEX IF EXISTS knowledge_docs_org_title_unique_unassigned;
--   DROP INDEX IF EXISTS datasets_org_name_unique_unassigned;
--   DROP INDEX IF EXISTS knowledge_docs_project_title_unique;
--   DROP INDEX IF EXISTS datasets_project_name_unique;
--   ALTER TABLE knowledge_documents DROP COLUMN IF EXISTS project_id;
--   ALTER TABLE datasets DROP COLUMN IF EXISTS project_id;
--   (the rollback re-create will fail if two projects have since taken the same name —
--    resolve those duplicates first.)
