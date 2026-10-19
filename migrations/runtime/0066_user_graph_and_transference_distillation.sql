-- User interest graph, synthetic personas, and the SLM-distillation columns on
-- transference_rules.
--
-- All four were declared in shared/schema (agent/user-graph.ts and
-- ai/transference.ts) with no migration behind them, so every query against
-- them failed against a real database. The failures were caught and logged as
-- warnings by their callers, which is why the platform looked healthy while
-- the persona, interest-graph and transference features were entirely dark:
--
--   [SyntheticPersona]   Failed to fetch persona for user …
--   [UserInterestGraph]  Failed to fetch top interests for user …
--   [TransferenceRouter] Execution skipped: Failed query …
--
-- transference_rules already exists; it is missing only the four columns added
-- alongside slm-adapter-distiller.service.ts. Written idempotently throughout.

CREATE TABLE IF NOT EXISTS "user_interests" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "user_id" text NOT NULL,
    "topic" text NOT NULL,
    "category" text DEFAULT 'general' NOT NULL,
    "weight" double precision DEFAULT 50.0 NOT NULL,
    "decay_score" double precision DEFAULT 50.0 NOT NULL,
    "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "last_reinforced_at" timestamp DEFAULT now() NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_project_activities" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "user_id" text NOT NULL,
    "project_id" integer,
    "action_type" text NOT NULL,
    "topic" text NOT NULL,
    "details" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "synthetic_personas" (
    "id" serial PRIMARY KEY NOT NULL,
    "organization_id" integer NOT NULL,
    "user_id" text NOT NULL,
    "archetype" text NOT NULL,
    "summary" text NOT NULL,
    "communication_directives" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "ocean_summary" jsonb NOT NULL,
    "active_focus_vector" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "risk_tolerance" text DEFAULT 'balanced' NOT NULL,
    "working_style" text DEFAULT 'hybrid' NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "last_synthesized_at" timestamp DEFAULT now() NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Foreign keys. `orgs` is keyed on org_id, not id — migration 0029 was orphaned
-- from the journal for referencing organizations(id), which does not exist.
DO $$ BEGIN
    ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "user_project_activities" ADD CONSTRAINT "user_project_activities_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "user_project_activities" ADD CONSTRAINT "user_project_activities_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "synthetic_personas" ADD CONSTRAINT "synthetic_personas_organization_id_orgs_org_id_fk"
        FOREIGN KEY ("organization_id") REFERENCES "orgs"("org_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "synthetic_personas" ADD CONSTRAINT "synthetic_personas_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_interests_org_user_topic"
    ON "user_interests" ("organization_id", "user_id", "topic");
CREATE INDEX IF NOT EXISTS "idx_user_interests_user_org"
    ON "user_interests" ("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_user_proj_act_user_org"
    ON "user_project_activities" ("organization_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_synthetic_personas_org_user"
    ON "synthetic_personas" ("organization_id", "user_id");

-- SLM adapter distillation columns.
ALTER TABLE "transference_rules" ADD COLUMN IF NOT EXISTS "adapter_path" text;
ALTER TABLE "transference_rules" ADD COLUMN IF NOT EXISTS "finetuned_at" timestamp;
ALTER TABLE "transference_rules" ADD COLUMN IF NOT EXISTS "training_pairs_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "transference_rules" ADD COLUMN IF NOT EXISTS "estimated_cost_savings_usd" integer DEFAULT 0 NOT NULL;
