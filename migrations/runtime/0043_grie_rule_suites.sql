-- Governed Rules & Decision Intelligence Engine (GRIE) tables.
--
-- These were previously created by raw SQL inside
-- `subscription-rule-engine.service.ensureTablesExist()` at runtime, so they
-- existed only wherever that code path had happened to run — present in the
-- test database, absent in dev, and in neither case matching the drizzle
-- schema. This migration makes them deterministic.
--
-- It is written to repair as well as create, because the runtime-created
-- tables are already out there and differ from the declared schema:
--   * no organization_id / event_primitive_id foreign keys
--   * no unique index on (suite_db_id, rule_id) — which is what makes a rule
--     upsert idempotent; without it a repeated save silently duplicates a rule
--   * no project_id column

CREATE TABLE IF NOT EXISTS "rule_suites" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "project_id" integer,
  "suite_id" text NOT NULL UNIQUE,
  "suite_name" text NOT NULL,
  "category" text NOT NULL DEFAULT 'Supply Chain & Logistics',
  "version" text NOT NULL DEFAULT '1.0.0',
  "owner" text NOT NULL DEFAULT 'Operations Team',
  "description" text,
  "execution_policy" text NOT NULL DEFAULT 'HIGHEST_PRIORITY_MAUF',
  "enabled" boolean NOT NULL DEFAULT true,
  "created_by" text NOT NULL DEFAULT 'system',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "rule_specifications" (
  "id" serial PRIMARY KEY,
  "suite_db_id" integer NOT NULL REFERENCES "rule_suites"("id") ON DELETE CASCADE,
  "rule_id" text NOT NULL,
  "rule_name" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "priority_weight" integer NOT NULL DEFAULT 50,
  "specification" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "rule_execution_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL,
  "suite_id" text NOT NULL,
  "rule_id" text NOT NULL,
  "event_primitive_id" uuid,
  "master_priority_score" integer NOT NULL,
  "matched_branch" text NOT NULL,
  "disposition" text NOT NULL,
  "fuzzy_scores" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "action_taken" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "executed_at" timestamp DEFAULT now() NOT NULL
);

-- Repair drift on tables that already exist from the runtime path.
ALTER TABLE "rule_suites" ADD COLUMN IF NOT EXISTS "project_id" integer;

-- Deduplicate before adding the unique index, otherwise the CREATE fails on any
-- database that already accumulated duplicate rules through the non-idempotent
-- insert path. Keeps the most recently updated row per (suite, rule).
DELETE FROM "rule_specifications" a
  USING "rule_specifications" b
  WHERE a."suite_db_id" = b."suite_db_id"
    AND a."rule_id" = b."rule_id"
    AND (a."updated_at" < b."updated_at"
         OR (a."updated_at" = b."updated_at" AND a."id" < b."id"));

CREATE INDEX IF NOT EXISTS "idx_rule_suites_org" ON "rule_suites" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_rule_suites_project" ON "rule_suites" ("organization_id", "project_id");
CREATE INDEX IF NOT EXISTS "idx_rule_specs_suite" ON "rule_specifications" ("suite_db_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_rule_specs_unique" ON "rule_specifications" ("suite_db_id", "rule_id");
CREATE INDEX IF NOT EXISTS "idx_rule_audits_org" ON "rule_execution_audits" ("organization_id", "executed_at");

-- Foreign keys the runtime path omitted. Guarded individually: ADD CONSTRAINT
-- has no IF NOT EXISTS, and a rerun must not abort the migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_suites_organization_id_fkey') THEN
    ALTER TABLE "rule_suites"
      ADD CONSTRAINT "rule_suites_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id") ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Skipped rule_suites org FK: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_suites_project_id_fkey') THEN
    ALTER TABLE "rule_suites"
      ADD CONSTRAINT "rule_suites_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Skipped rule_suites project FK: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_execution_audits_organization_id_fkey') THEN
    ALTER TABLE "rule_execution_audits"
      ADD CONSTRAINT "rule_execution_audits_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id") ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Skipped rule_execution_audits org FK: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rule_execution_audits_event_primitive_id_fkey') THEN
    ALTER TABLE "rule_execution_audits"
      ADD CONSTRAINT "rule_execution_audits_event_primitive_id_fkey"
      FOREIGN KEY ("event_primitive_id") REFERENCES "event_primitives"("id") ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Skipped rule_execution_audits event FK: %', SQLERRM;
END $$;
