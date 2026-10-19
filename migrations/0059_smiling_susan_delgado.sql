CREATE TABLE "user_representations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"communication_style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contradictions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turns_since_reconcile" integer DEFAULT 0 NOT NULL,
	"last_reconciled_at" timestamp,
	"dialectic_depth" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_knowledge_graph_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"confidence" integer DEFAULT 100 NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"source_template_id" integer NOT NULL,
	"source_mission_run_id" integer,
	"source_job_id" integer,
	"proposed_config" jsonb NOT NULL,
	"diff_summary" text NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"reviewer_comments" text,
	"proposed_version" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_app_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"mission_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"label" text,
	"open_mode_default" text DEFAULT 'modal' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'blueprint' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_long_term_memories" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_long_term_memories" ADD COLUMN "confidence" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_step_executions" ADD COLUMN "dependency_status" varchar(20);--> statement-breakpoint
ALTER TABLE "pipeline_step_executions" ADD COLUMN "dependency_resolution_time" timestamp;--> statement-breakpoint
ALTER TABLE "job_dependencies" ADD COLUMN "dependency_type" varchar(20) DEFAULT 'hard' NOT NULL;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "source_template_id" integer;--> statement-breakpoint
ALTER TABLE "user_representations" ADD CONSTRAINT "user_representations_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_representations" ADD CONSTRAINT "user_representations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_graph_entries" ADD CONSTRAINT "agent_knowledge_graph_entries_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_proposals" ADD CONSTRAINT "template_proposals_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_proposals" ADD CONSTRAINT "template_proposals_source_template_id_mission_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."mission_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_proposals" ADD CONSTRAINT "template_proposals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_app_bindings" ADD CONSTRAINT "mission_app_bindings_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_app_bindings" ADD CONSTRAINT "mission_app_bindings_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_representations_user_org_unique" ON "user_representations" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "user_representations_candidates_idx" ON "user_representations" USING btree ("turns_since_reconcile","last_reconciled_at");--> statement-breakpoint
CREATE INDEX "idx_agent_kg_org_agent_repo" ON "agent_knowledge_graph_entries" USING btree ("organization_id","agent_id","repository_id");--> statement-breakpoint
CREATE INDEX "template_proposals_org_status_idx" ON "template_proposals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "template_proposals_template_idx" ON "template_proposals" USING btree ("source_template_id");--> statement-breakpoint
CREATE INDEX "template_proposals_run_idx" ON "template_proposals" USING btree ("source_mission_run_id");--> statement-breakpoint
CREATE INDEX "mab_mission_idx" ON "mission_app_bindings" USING btree ("mission_id","sort_order");--> statement-breakpoint
CREATE INDEX "mab_org_idx" ON "mission_app_bindings" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mab_unique" ON "mission_app_bindings" USING btree ("mission_id","app_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "job_deps_unique_idx" ON "job_dependencies" USING btree ("job_id","depends_on_job_id");--> statement-breakpoint
CREATE INDEX "idx_missions_source_template_id" ON "missions" USING btree ("source_template_id");