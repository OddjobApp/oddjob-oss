CREATE TABLE "artifact_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"mime_type" text DEFAULT 'application/json' NOT NULL,
	"contract_schema" jsonb,
	"validated_at" timestamp with time zone,
	"mission_run_id" integer,
	"organization_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" text NOT NULL,
	"cycle_id" integer,
	"organization_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_phase" text,
	"phase_sequence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget_limit_usd" numeric(12, 2),
	"current_cost_usd" numeric(12, 2) DEFAULT '0.00',
	"token_count" integer DEFAULT 0,
	"ttl_hours" integer,
	"expires_at" timestamp with time zone,
	"trace_id" varchar(32),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle_blueprints" ADD COLUMN "artifact_contracts" jsonb;--> statement-breakpoint
ALTER TABLE "artifact_registry" ADD CONSTRAINT "artifact_registry_session_id_generation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."generation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_registry" ADD CONSTRAINT "artifact_registry_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_registry" ADD CONSTRAINT "artifact_registry_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_cycle_id_operational_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."operational_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_artifact_unique" ON "artifact_registry" USING btree ("session_id","phase","name","version");--> statement-breakpoint
CREATE INDEX "idx_artifact_session" ON "artifact_registry" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_artifact_phase" ON "artifact_registry" USING btree ("session_id","phase");--> statement-breakpoint
CREATE INDEX "idx_gen_sessions_org" ON "generation_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gen_sessions_status" ON "generation_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_gen_sessions_cycle" ON "generation_sessions" USING btree ("cycle_id");