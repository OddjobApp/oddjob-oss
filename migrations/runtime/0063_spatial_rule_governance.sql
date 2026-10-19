-- Spatial rule governance: project isolation, tenant-safe suite identity, and
-- a durable pointer to the exact stored rule that produced an audit.

ALTER TABLE "event_primitives"
  ADD COLUMN IF NOT EXISTS "project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL;

ALTER TABLE "rule_execution_audits"
  ADD COLUMN IF NOT EXISTS "project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL;

ALTER TABLE "rule_execution_audits"
  ADD COLUMN IF NOT EXISTS "rule_specification_id" integer REFERENCES "rule_specifications"("id") ON DELETE SET NULL;

ALTER TABLE "rule_suites"
  DROP CONSTRAINT IF EXISTS "rule_suites_suite_id_unique";

DROP INDEX IF EXISTS "rule_suites_suite_id_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_rule_suites_scope_unique"
  ON "rule_suites" ("organization_id", "project_id", "suite_id");

CREATE INDEX IF NOT EXISTS "idx_event_primitives_project"
  ON "event_primitives" ("organization_id", "project_id", "extraction_timestamp");

CREATE INDEX IF NOT EXISTS "idx_rule_audits_project"
  ON "rule_execution_audits" ("organization_id", "project_id", "executed_at");
