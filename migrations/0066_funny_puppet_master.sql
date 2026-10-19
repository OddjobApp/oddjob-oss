CREATE TABLE "agent_credential_leases" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_identity_id" text NOT NULL,
	"credential_id" integer NOT NULL,
	"tool" text NOT NULL,
	"action" text NOT NULL,
	"resource" text DEFAULT '*' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"lease_reason" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_governance_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_identity_id" text,
	"agent_id" text NOT NULL,
	"run_id" text,
	"initiated_by" text,
	"tool" text NOT NULL,
	"action" text NOT NULL,
	"resource" text DEFAULT '*' NOT NULL,
	"decision" text NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"policy_codes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"input_hash" text,
	"output_hash" text,
	"status" text DEFAULT 'recorded' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_identities" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_id" text NOT NULL,
	"display_name" text NOT NULL,
	"owner_id" text NOT NULL,
	"environment" text DEFAULT 'dev' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"policy_bundle_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_permission_grants" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_identity_id" text NOT NULL,
	"tool" text NOT NULL,
	"action" text NOT NULL,
	"resource" text DEFAULT '*' NOT NULL,
	"effect" text DEFAULT 'allow' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_chat_contexts" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"context_data" jsonb NOT NULL,
	"is_template" boolean DEFAULT false,
	"usage_count" integer DEFAULT 0,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_chat_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'active',
	"message_count" integer DEFAULT 0,
	"last_message_at" timestamp,
	"organization_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ontology_action_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"action_id" integer,
	"actor_user_id" text,
	"params" jsonb,
	"approval_id" integer,
	"status" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ontology_actions" (
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
);
--> statement-breakpoint
CREATE TABLE "ontology_object_types" (
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
);
--> statement-breakpoint
CREATE TABLE "ontology_objects" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"object_type_id" integer NOT NULL,
	"external_id" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kg_node_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ALTER COLUMN "embedding" SET DATA TYPE vector(768);--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ADD COLUMN "thread_id" integer;--> statement-breakpoint
ALTER TABLE "agent_credential_leases" ADD CONSTRAINT "agent_credential_leases_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credential_leases" ADD CONSTRAINT "agent_credential_leases_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_governance_audit_events" ADD CONSTRAINT "agent_governance_audit_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_governance_audit_events" ADD CONSTRAINT "agent_governance_audit_events_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_permission_grants" ADD CONSTRAINT "agent_permission_grants_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_permission_grants" ADD CONSTRAINT "agent_permission_grants_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_contexts" ADD CONSTRAINT "agent_chat_contexts_agent_id_jobs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_contexts" ADD CONSTRAINT "agent_chat_contexts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_threads" ADD CONSTRAINT "agent_chat_threads_agent_id_jobs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_threads" ADD CONSTRAINT "agent_chat_threads_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_action_log" ADD CONSTRAINT "ontology_action_log_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_action_log" ADD CONSTRAINT "ontology_action_log_action_id_ontology_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."ontology_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_actions" ADD CONSTRAINT "ontology_actions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_actions" ADD CONSTRAINT "ontology_actions_object_type_id_ontology_object_types_id_fk" FOREIGN KEY ("object_type_id") REFERENCES "public"."ontology_object_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_object_types" ADD CONSTRAINT "ontology_object_types_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_objects" ADD CONSTRAINT "ontology_objects_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_objects" ADD CONSTRAINT "ontology_objects_object_type_id_ontology_object_types_id_fk" FOREIGN KEY ("object_type_id") REFERENCES "public"."ontology_object_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_credential_leases_org" ON "agent_credential_leases" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_agent_credential_leases_identity" ON "agent_credential_leases" USING btree ("agent_identity_id");--> statement-breakpoint
CREATE INDEX "idx_agent_credential_leases_status" ON "agent_credential_leases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agent_credential_leases_expires" ON "agent_credential_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_agent_gov_audit_org" ON "agent_governance_audit_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_agent_gov_audit_agent" ON "agent_governance_audit_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_agent_gov_audit_decision" ON "agent_governance_audit_events" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "idx_agent_gov_audit_created" ON "agent_governance_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_identities_org" ON "agent_identities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_agent_identities_agent" ON "agent_identities" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_agent_identities_status" ON "agent_identities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agent_permission_grants_org" ON "agent_permission_grants" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_agent_permission_grants_identity" ON "agent_permission_grants" USING btree ("agent_identity_id");--> statement-breakpoint
CREATE INDEX "idx_agent_permission_grants_tool_action" ON "agent_permission_grants" USING btree ("tool","action");--> statement-breakpoint
CREATE INDEX "agent_chat_contexts_agent_idx" ON "agent_chat_contexts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_chat_contexts_user_idx" ON "agent_chat_contexts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_chat_contexts_template_idx" ON "agent_chat_contexts" USING btree ("is_template");--> statement-breakpoint
CREATE INDEX "agent_chat_threads_agent_idx" ON "agent_chat_threads" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_chat_threads_user_idx" ON "agent_chat_threads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_chat_threads_status_idx" ON "agent_chat_threads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ontology_action_log_org_idx" ON "ontology_action_log" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ontology_action_org_name_unique" ON "ontology_actions" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "ontology_action_org_idx" ON "ontology_actions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ontology_object_type_org_name_unique" ON "ontology_object_types" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "ontology_object_type_org_idx" ON "ontology_object_types" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ontology_object_org_type_extid_unique" ON "ontology_objects" USING btree ("organization_id","object_type_id","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ontology_object_org_type_idx" ON "ontology_objects" USING btree ("organization_id","object_type_id");--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_thread_id_agent_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_chat_messages_thread_idx" ON "agent_chat_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "agent_chat_messages_embedding_idx" ON "agent_chat_messages" USING ivfflat ("embedding" vector_cosine_ops);