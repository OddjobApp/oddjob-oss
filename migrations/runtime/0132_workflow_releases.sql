-- 0132_workflow_releases
--
-- Workflow lifecycle: a workflow is a product identity owned by a Project Space,
-- its draft an editable pipeline; a release is an immutable manifest snapshot of
-- that draft; a deployment activates one release in an environment. Executions
-- record which release/deployment they ran under.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"draft_pipeline_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"release_number" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"digest" text NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"release_id" integer NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"activation_generation" integer DEFAULT 0 NOT NULL,
	"bindings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activated_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_orgs_org_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflows" ADD CONSTRAINT "workflows_draft_pipeline_id_pipelines_id_fk"
		FOREIGN KEY ("draft_pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_releases" ADD CONSTRAINT "workflow_releases_workflow_id_workflows_id_fk"
		FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_deployments" ADD CONSTRAINT "workflow_deployments_workflow_id_workflows_id_fk"
		FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_deployments" ADD CONSTRAINT "workflow_deployments_release_id_workflow_releases_id_fk"
		FOREIGN KEY ("release_id") REFERENCES "public"."workflow_releases"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflows_draft_pipeline_unique" ON "workflows" ("draft_pipeline_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_org_status_idx" ON "workflows" ("organization_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_releases_workflow_number_unique" ON "workflow_releases" ("workflow_id", "release_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_releases_workflow_digest_idx" ON "workflow_releases" ("workflow_id", "digest");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_deployments_workflow_env_unique" ON "workflow_deployments" ("workflow_id", "environment");
--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD COLUMN IF NOT EXISTS "workflow_release_id" integer;
--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD COLUMN IF NOT EXISTS "workflow_deployment_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_executions_workflow_release_idx" ON "pipeline_executions" ("workflow_release_id");
