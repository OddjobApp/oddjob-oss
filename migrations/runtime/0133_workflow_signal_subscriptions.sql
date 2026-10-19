-- 0133_workflow_signal_subscriptions
--
-- Signal → workflow binding: a subscription filters incoming event primitives
-- and starts a run of the workflow's active deployment; the delivery row is
-- unique per (subscription, event primitive) so both delivery paths (the
-- in-process bridge and the Kafka consumer) can fire without double-starting.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "workflow_signal_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"workflow_id" integer NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"cooldown_minutes" integer DEFAULT 0 NOT NULL,
	"last_delivered_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_signal_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"subscription_id" integer NOT NULL,
	"workflow_id" integer NOT NULL,
	"event_primitive_id" uuid NOT NULL,
	"release_id" integer,
	"deployment_id" integer,
	"pipeline_execution_id" integer,
	"disposition" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_signal_subscriptions" ADD CONSTRAINT "workflow_signal_subscriptions_organization_id_orgs_org_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_signal_subscriptions" ADD CONSTRAINT "workflow_signal_subscriptions_workflow_id_workflows_id_fk"
		FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_signal_deliveries" ADD CONSTRAINT "workflow_signal_deliveries_subscription_id_workflow_signal_subscriptions_id_fk"
		FOREIGN KEY ("subscription_id") REFERENCES "public"."workflow_signal_subscriptions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflow_signal_deliveries" ADD CONSTRAINT "workflow_signal_deliveries_event_primitive_id_event_primitives_id_fk"
		FOREIGN KEY ("event_primitive_id") REFERENCES "public"."event_primitives"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_signal_subscriptions_org_idx" ON "workflow_signal_subscriptions" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_signal_subscriptions_workflow_idx" ON "workflow_signal_subscriptions" ("workflow_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_signal_deliveries_subscription_event_unique" ON "workflow_signal_deliveries" ("subscription_id", "event_primitive_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_signal_deliveries_workflow_idx" ON "workflow_signal_deliveries" ("workflow_id", "delivered_at");
