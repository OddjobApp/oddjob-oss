CREATE TABLE "cost_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"agent_deployment_id" integer,
	"mission_id" integer,
	"session_id" text,
	"model" text NOT NULL,
	"provider" text DEFAULT 'openai' NOT NULL,
	"tokens_prompt" integer DEFAULT 0 NOT NULL,
	"tokens_completion" integer DEFAULT 0 NOT NULL,
	"tokens_total" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT '0.000000' NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heartbeat_triggers" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"agent_deployment_id" integer,
	"name" varchar(120) NOT NULL,
	"description" text,
	"source_type" varchar(50) NOT NULL,
	"source_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"polling_interval_ms" integer DEFAULT 60000 NOT NULL,
	"last_item_id" text,
	"last_polled_at" timestamp,
	"mission_title_template" text,
	"mission_priority" varchar(20) DEFAULT 'normal',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" integer,
	"content" text NOT NULL,
	"kind" text DEFAULT 'fact' NOT NULL,
	"source" text DEFAULT 'assistant' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_deployments" ADD COLUMN "reports_to_id" integer;--> statement-breakpoint
ALTER TABLE "agent_deployments" ADD COLUMN "org_role" text DEFAULT 'worker';--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "capability_contract" jsonb;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_agent_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_triggers" ADD CONSTRAINT "heartbeat_triggers_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_triggers" ADD CONSTRAINT "heartbeat_triggers_agent_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory" ADD CONSTRAINT "user_memory_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cost_ledger_org_recorded" ON "cost_ledger" USING btree ("org_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_cost_ledger_agent" ON "cost_ledger" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE INDEX "idx_cost_ledger_mission" ON "cost_ledger" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "idx_heartbeat_triggers_org" ON "heartbeat_triggers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_heartbeat_triggers_active" ON "heartbeat_triggers" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_heartbeat_triggers_agent" ON "heartbeat_triggers" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE INDEX "user_memory_user_idx" ON "user_memory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_memory_user_org_idx" ON "user_memory" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "agent_deployments_reports_to_idx" ON "agent_deployments" USING btree ("reports_to_id");--> statement-breakpoint
CREATE INDEX "agent_deployments_org_hierarchy_idx" ON "agent_deployments" USING btree ("organization_id","reports_to_id");