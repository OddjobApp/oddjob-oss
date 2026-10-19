-- PostgreSQL may name the legacy inline UNIQUE constraint with `_key` while
-- Drizzle-generated databases use `_unique`. Remove both before enforcing the
-- organization/project-scoped identity.
ALTER TABLE "rule_suites" DROP CONSTRAINT IF EXISTS "rule_suites_suite_id_key";
ALTER TABLE "rule_suites" DROP CONSTRAINT IF EXISTS "rule_suites_suite_id_unique";
DROP INDEX IF EXISTS "rule_suites_suite_id_key";
DROP INDEX IF EXISTS "rule_suites_suite_id_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_rule_suites_scope_unique"
  ON "rule_suites" ("organization_id", "project_id", "suite_id");
