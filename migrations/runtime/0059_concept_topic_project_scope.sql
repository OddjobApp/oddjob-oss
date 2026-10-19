-- Project-scope the concept/topic vocabulary.
--
-- knowledge_topics and knowledge_concepts were organization-scoped only, with a
-- unique index on (organization_id, name). That is correct for Oddjob's own
-- system vocabulary but cannot hold per-property vocabularies: two projects in
-- one organization could never both own a concept called "Pricing".
--
-- project_id NULL  = organization-wide vocabulary, shared by every project
-- project_id SET   = private to that Project Space
--
-- TWO PARTIAL UNIQUE INDEXES, not one composite. Postgres treats NULLs as
-- distinct in a unique index, so a single index over
-- (organization_id, project_id, name) would allow unlimited duplicate
-- org-level rows — removing the very guarantee the original constraint gave.

ALTER TABLE "knowledge_topics"   ADD COLUMN IF NOT EXISTS "project_id" integer;
--> statement-breakpoint
ALTER TABLE "knowledge_concepts" ADD COLUMN IF NOT EXISTS "project_id" integer;
--> statement-breakpoint

DROP INDEX IF EXISTS "knowledge_topics_org_name_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "knowledge_concepts_org_name_unique";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_topics_org_name_unique"
  ON "knowledge_topics" ("organization_id", "name")
  WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_topics_org_project_name_unique"
  ON "knowledge_topics" ("organization_id", "project_id", "name")
  WHERE "project_id" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_concepts_org_name_unique"
  ON "knowledge_concepts" ("organization_id", "name")
  WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_concepts_org_project_name_unique"
  ON "knowledge_concepts" ("organization_id", "project_id", "name")
  WHERE "project_id" IS NOT NULL;
--> statement-breakpoint

-- Lookup path for resolving a project's vocabulary.
CREATE INDEX IF NOT EXISTS "knowledge_topics_project_idx"
  ON "knowledge_topics" ("organization_id", "project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_concepts_project_idx"
  ON "knowledge_concepts" ("organization_id", "project_id");
