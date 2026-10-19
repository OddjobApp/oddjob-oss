-- Ontology core tables.
--
-- These are declared by the runtime baseline, but the baseline was never
-- applied to every environment: this database was built by the older root
-- migrations chain and only picked the runtime chain up from 0055, so the 54
-- migrations before it — the baseline included — are absent from its ledger.
-- Anything the baseline introduces that the old chain never created is
-- therefore missing, which is why ontology_object_types, ontology_objects,
-- ontology_actions and ontology_action_log do not exist while
-- ontology_type_versions (added later) does.
--
-- Re-running the baseline is not an option: it would collide with the 321
-- tables that already exist. This follows the precedent set by 0058, which
-- repaired scoring_events the same way — a forward migration creating only
-- what is missing.
--
-- Every statement is guarded. In an environment where the baseline DID apply,
-- this migration is a no-op rather than an error.

CREATE TABLE IF NOT EXISTS "ontology_object_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"properties_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title_property" text,
	"icon" text,
	"backing" text DEFAULT 'materialized' NOT NULL,
	"source_adapter" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ontology_objects" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"object_type_id" integer NOT NULL,
	"external_id" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kg_node_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ontology_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"object_type_id" integer,
	"parameters_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effect" text DEFAULT 'read' NOT NULL,
	"handler_kind" text NOT NULL,
	"handler_ref" text NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ontology_action_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"action_id" integer,
	"actor_user_id" text,
	"params" jsonb,
	"approval_id" integer,
	"mission_run_id" integer,
	"status" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Foreign keys. Org scoping is the isolation boundary for every ontology read,
-- so the cascade to orgs matters: an org's types and objects must not outlive
-- it. DO blocks because ADD CONSTRAINT has no IF NOT EXISTS.
DO $$ BEGIN
	ALTER TABLE "ontology_object_types" ADD CONSTRAINT "ontology_object_types_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_objects" ADD CONSTRAINT "ontology_objects_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_objects" ADD CONSTRAINT "ontology_objects_object_type_id_ontology_object_types_id_fk" FOREIGN KEY ("object_type_id") REFERENCES "public"."ontology_object_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_actions" ADD CONSTRAINT "ontology_actions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_actions" ADD CONSTRAINT "ontology_actions_object_type_id_ontology_object_types_id_fk" FOREIGN KEY ("object_type_id") REFERENCES "public"."ontology_object_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_action_log" ADD CONSTRAINT "ontology_action_log_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_action_log" ADD CONSTRAINT "ontology_action_log_action_id_ontology_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."ontology_actions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ontology_action_log" ADD CONSTRAINT "ontology_action_log_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Indexes. The org+name uniques are what make seedDefaultObjectTypes idempotent
-- (it relies on ON CONFLICT DO NOTHING against them), so seeding would insert
-- duplicate types on every call without these.
CREATE UNIQUE INDEX IF NOT EXISTS "ontology_object_type_org_name_unique" ON "ontology_object_types" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_object_type_org_idx" ON "ontology_object_types" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ontology_object_org_type_extid_unique" ON "ontology_objects" USING btree ("organization_id","object_type_id","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_object_org_type_idx" ON "ontology_objects" USING btree ("organization_id","object_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ontology_action_org_name_unique" ON "ontology_actions" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_action_org_idx" ON "ontology_actions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_action_log_org_idx" ON "ontology_action_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ontology_action_log_run_idx" ON "ontology_action_log" USING btree ("mission_run_id");
