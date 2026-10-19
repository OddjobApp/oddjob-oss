ALTER TABLE "ontology_action_log" ADD COLUMN IF NOT EXISTS "mission_run_id" integer;
DO $$ BEGIN
ALTER TABLE "ontology_action_log" ADD CONSTRAINT "ontology_action_log_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "ontology_action_log_run_idx" ON "ontology_action_log" USING btree ("mission_run_id");

CREATE TABLE IF NOT EXISTS "copilot_command_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "user_id" text,
  "command_id" text NOT NULL,
  "surface" text NOT NULL,
  "risk_level" text NOT NULL,
  "requires_approval" boolean NOT NULL,
  "mission_id" integer,
  "mission_run_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
DO $$ BEGIN
ALTER TABLE "copilot_command_events" ADD CONSTRAINT "copilot_command_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
ALTER TABLE "copilot_command_events" ADD CONSTRAINT "copilot_command_events_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "copilot_command_events_org_created_idx" ON "copilot_command_events" USING btree ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "copilot_command_events_command_idx" ON "copilot_command_events" USING btree ("command_id");

CREATE TABLE IF NOT EXISTS "copilot_source_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "user_id" text,
  "source_id" text NOT NULL,
  "source_type" text DEFAULT 'knowledge' NOT NULL,
  "original_confidence" double precision NOT NULL,
  "outcome" text NOT NULL,
  "outcome_score" double precision NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
DO $$ BEGIN
ALTER TABLE "copilot_source_reviews" ADD CONSTRAINT "copilot_source_reviews_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "copilot_source_reviews_org_source_idx" ON "copilot_source_reviews" USING btree ("organization_id", "source_id");
CREATE INDEX IF NOT EXISTS "copilot_source_reviews_org_created_idx" ON "copilot_source_reviews" USING btree ("organization_id", "created_at");
