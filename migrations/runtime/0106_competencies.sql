-- Competency ledger: the tables shared/schema/competencies.ts already declares.
--
-- These were added to the Drizzle schema and exported from shared/schema/index.ts
-- without a migration, so every reader and writer -- the governor HR routes, the
-- upskilling orchestrator's promoteAgentCompetency, the AgenticHR UI -- fails with
-- "relation does not exist" against any real database. The orchestrator swallows
-- that failure and still reports success, so the gap is invisible at runtime.
--
-- NOTE: orgs' primary key column is "org_id" (Drizzle maps it to .id), so the
-- foreign keys below reference orgs(org_id), not orgs(id).

CREATE TABLE IF NOT EXISTS "competencies" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "category" text DEFAULT 'general' NOT NULL,
    "description" text,
    "organization_id" integer REFERENCES orgs(org_id) ON DELETE CASCADE,
    "metadata" jsonb DEFAULT '{}'::jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_competencies_org_id" ON "competencies" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_competencies_category" ON "competencies" ("category");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "actor_competencies" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer REFERENCES orgs(org_id) ON DELETE CASCADE,
    "actor_type" text DEFAULT 'agent' NOT NULL,
    "actor_id" text NOT NULL,
    "competency_id" integer NOT NULL REFERENCES "competencies"("id") ON DELETE CASCADE,
    "proficiency_level" integer DEFAULT 1 NOT NULL,
    "verified_at" timestamp DEFAULT now() NOT NULL,
    "verified_by" text,
    "metadata" jsonb DEFAULT '{}'::jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_actor_comp_org" ON "actor_competencies" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_actor_comp_actor" ON "actor_competencies" ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_actor_comp_competency" ON "actor_competencies" ("competency_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_actor_comp_unique" ON "actor_competencies" ("actor_type","actor_id","competency_id");
