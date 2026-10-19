CREATE TYPE "public"."sales_activity_type" AS ENUM('REPLY', 'MEETING', 'DEMO', 'PROPOSAL_OPENED', 'CALL', 'EMAIL_SENT', 'STAGE_ADVANCED', 'NOTE');--> statement-breakpoint
CREATE TYPE "public"."sales_lead_status" AS ENUM('NEW', 'QUALIFYING', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED');--> statement-breakpoint
CREATE TYPE "public"."sales_rearm_effect" AS ENUM('HOLD', 'REBASELINE', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."sales_recommendation_kind" AS ENUM('slip_risk', 'stalled', 'aging', 'next_best_action', 'win', 'loss');--> statement-breakpoint
CREATE TYPE "public"."sales_recommendation_status" AS ENUM('OPEN', 'ACTED', 'SNOOZED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."sales_stage" AS ENUM('PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST');--> statement-breakpoint
CREATE TYPE "public"."sales_window_status" AS ENUM('ARMED', 'DECAYING', 'WON', 'LOST');--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprint_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"blueprint_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"template_version" varchar(20) DEFAULT '1.0.0' NOT NULL,
	"template_config" jsonb,
	"parameter_schema" jsonb,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"blueprint_template_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"execution_uuid" varchar(36) NOT NULL,
	"execution_name" varchar(255) NOT NULL,
	"pipeline_execution_id" integer,
	"pipeline_id" integer,
	"input_parameters" jsonb,
	"output_data" jsonb,
	"metadata" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"execution_time_ms" integer,
	"error_message" text,
	"error_stack" text,
	"retry_count" integer DEFAULT 0,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "template_executions_execution_uuid_unique" UNIQUE("execution_uuid")
);
--> statement-breakpoint
CREATE TABLE "cycle_run_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"step_code" varchar(50) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"job_id" integer,
	"agent_id" varchar(100),
	"inputs" jsonb,
	"outputs" jsonb,
	"error" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "evaluation_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"harness_id" text NOT NULL,
	"harness_version" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"metrics" jsonb,
	"trace_id" text,
	"failure_reason" jsonb
);
--> statement-breakpoint
CREATE TABLE "failure_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"harness_id" text NOT NULL,
	"harness_version" text NOT NULL,
	"pattern_signature" jsonb NOT NULL,
	"cluster_size" serial NOT NULL,
	"representative_traces" jsonb,
	"actionability_score" serial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harness_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"harness_id" text NOT NULL,
	"parent_harness_version" text NOT NULL,
	"proposed_change" jsonb NOT NULL,
	"rationale" text,
	"proposed_by_agent_id" text,
	"validation_status" text NOT NULL,
	"validation_results" jsonb,
	"human_approved_at" timestamp,
	"human_approved_by" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_execution_id" integer,
	"pipeline_step_execution_id" integer,
	"organization_id" integer NOT NULL,
	"execution_time_ms" integer NOT NULL,
	"queue_time_ms" integer,
	"setup_time_ms" integer,
	"teardown_time_ms" integer,
	"peak_memory_mb" numeric(10, 2),
	"cpu_percentage" numeric(5, 2),
	"input_record_count" integer,
	"output_record_count" integer,
	"records_per_second" numeric(15, 2),
	"dropped_record_count" integer DEFAULT 0,
	"error_record_count" integer DEFAULT 0,
	"bytes_read" integer,
	"bytes_written" integer,
	"network_latency_ms" numeric(10, 2),
	"status" varchar(20) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text,
	"api_key_id" integer,
	"endpoint_path" text NOT NULL,
	"http_method" varchar(10) NOT NULL,
	"role" text,
	"request_count" integer DEFAULT 1 NOT NULL,
	"limit_threshold" integer,
	"limit_window_seconds" integer,
	"limit_exceeded" boolean DEFAULT false,
	"throttled_duration_ms" integer,
	"status_code" integer,
	"response_time_ms" integer,
	"request_body_bytes" integer,
	"response_body_bytes" integer,
	"ip_address" varchar(45),
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_version_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"skill_id" integer NOT NULL,
	"code" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"source" text DEFAULT 'manual' NOT NULL,
	"shadow_run_id" integer,
	"strategy_description" text,
	"promoted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_violations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" integer,
	"agent_id" text,
	"role" text NOT NULL,
	"check_type" text NOT NULL,
	"check_value" text NOT NULL,
	"enforcement" text NOT NULL,
	"mission_id" integer,
	"pipeline_id" integer,
	"job_id" integer,
	"blocked" boolean DEFAULT false NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"account_key" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"industry" text,
	"segment" text,
	"owner_rep" text,
	"external_crm_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"opportunity_id" integer NOT NULL,
	"activity_key" text NOT NULL,
	"type" "sales_activity_type" NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"actor" text,
	"summary" text,
	"is_rearm_signal" boolean DEFAULT false NOT NULL,
	"rearm_effect" "sales_rearm_effect" DEFAULT 'NONE' NOT NULL,
	"weight" numeric(6, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"account_id" integer,
	"contact_key" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"title" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"external_crm_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_forecasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"forecast_key" text NOT NULL,
	"period" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"weighted_pipeline" numeric(14, 2) DEFAULT '0' NOT NULL,
	"committed" numeric(14, 2) DEFAULT '0' NOT NULL,
	"best_case" numeric(14, 2) DEFAULT '0' NOT NULL,
	"deal_count" integer DEFAULT 0 NOT NULL,
	"generated_by" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"prospect_lead_id" integer,
	"lead_key" text NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"source" text,
	"estimated_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"timeline" text,
	"status" "sales_lead_status" DEFAULT 'NEW' NOT NULL,
	"qualification_score" numeric(5, 4),
	"converted_account_id" integer,
	"converted_contact_id" integer,
	"converted_opportunity_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"lead_id" integer,
	"opportunity_key" text NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"stage" "sales_stage" DEFAULT 'PROSPECT' NOT NULL,
	"stage_entitlement" integer DEFAULT 90 NOT NULL,
	"owner_rep" text,
	"expected_close" timestamp,
	"outcome" text,
	"closed_at" timestamp,
	"external_crm_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_opportunity_windows" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"opportunity_id" integer NOT NULL,
	"window_key" text NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"cycle_length_days" integer NOT NULL,
	"gate_ladder" jsonb DEFAULT '[90,60,30,0]'::jsonb NOT NULL,
	"current_gate_index" integer DEFAULT 0 NOT NULL,
	"current_ceiling" integer DEFAULT 90 NOT NULL,
	"next_gate_deadline" timestamp NOT NULL,
	"grace_period_hours" integer DEFAULT 0 NOT NULL,
	"rearm_signals" jsonb DEFAULT '["REPLY","MEETING","DEMO","PROPOSAL_OPENED","STAGE_ADVANCED"]'::jsonb NOT NULL,
	"last_rearm_at" timestamp,
	"status" "sales_window_status" DEFAULT 'ARMED' NOT NULL,
	"outcome" text,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sales_quotas" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"quota_key" text NOT NULL,
	"owner_rep" text NOT NULL,
	"period" text NOT NULL,
	"target_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"attainment" numeric(8, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_recommendations_domain" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"opportunity_id" integer NOT NULL,
	"recommendation_key" text NOT NULL,
	"kind" "sales_recommendation_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" "sales_recommendation_status" DEFAULT 'OPEN' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_stage_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"opportunity_id" integer NOT NULL,
	"from_stage" "sales_stage",
	"to_stage" "sales_stage" NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"changed_by" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "sales_window_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"window_id" integer NOT NULL,
	"opportunity_id" integer NOT NULL,
	"snapshot_key" text NOT NULL,
	"taken_at" timestamp DEFAULT now() NOT NULL,
	"gate_index" integer NOT NULL,
	"ceiling_before" integer NOT NULL,
	"ceiling_after" integer NOT NULL,
	"amount_at_snapshot" numeric(14, 2) DEFAULT '0' NOT NULL,
	"weighted_value" numeric(14, 2) DEFAULT '0' NOT NULL,
	"trigger" text NOT NULL,
	"realized_outcome" integer
);
--> statement-breakpoint
CREATE TABLE "mission_agent_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_run_id" integer NOT NULL,
	"agent_deployment_id" integer NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"config_snapshot" jsonb DEFAULT '{}'::jsonb,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consistency_remediation_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"auto_remediate_enabled" boolean DEFAULT true NOT NULL,
	"remediate_missing_container" boolean DEFAULT true NOT NULL,
	"remediate_state_mismatch" boolean DEFAULT true NOT NULL,
	"remediate_port_conflict" boolean DEFAULT false NOT NULL,
	"restart_strategy" varchar(20) DEFAULT 'graceful' NOT NULL,
	"restart_timeout_seconds" integer DEFAULT 30 NOT NULL,
	"max_restart_attempts" integer DEFAULT 3 NOT NULL,
	"alert_on_divergence" boolean DEFAULT true NOT NULL,
	"alert_channels" text DEFAULT 'slack' NOT NULL,
	"alert_severity" varchar(20) DEFAULT 'warning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_consistency_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"check_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"db_status" varchar(20),
	"db_container_id" varchar(256),
	"db_port" integer,
	"docker_exists" boolean,
	"docker_running" boolean,
	"docker_container_id" varchar(256),
	"docker_exit_code" integer,
	"docker_last_error" text,
	"divergence_type" varchar(50),
	"divergence_details" jsonb,
	"remediation_attempted" boolean DEFAULT false NOT NULL,
	"remediation_action" varchar(100),
	"remediation_success" boolean,
	"remediation_error" text,
	"outcome" varchar(50) NOT NULL,
	"alert_sent" boolean DEFAULT false NOT NULL,
	"org_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_image_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"image_name" varchar(256) NOT NULL,
	"image_tag" varchar(100) NOT NULL,
	"image_digest" varchar(256),
	"first_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"size_mb" integer,
	"layers" integer,
	"available" boolean DEFAULT true NOT NULL,
	"deprecated" boolean DEFAULT false NOT NULL,
	"org_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_lifecycle_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"operation" varchar(50) NOT NULL,
	"operation_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"container_id" varchar(256),
	"image_name" varchar(256),
	"image_tag" varchar(100),
	"image_digest" varchar(256),
	"memory_limit_mb" integer,
	"cpu_limit_millicores" integer,
	"status" varchar(20) NOT NULL,
	"duration_ms" integer,
	"error_message" text,
	"error_stacktrace" text,
	"volumes_created" integer DEFAULT 0 NOT NULL,
	"volumes_deleted" integer DEFAULT 0 NOT NULL,
	"org_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"performed_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "container_volumes" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer,
	"volume_name" varchar(256) NOT NULL,
	"volume_type" varchar(20) NOT NULL,
	"mount_path" varchar(256) NOT NULL,
	"host_path" varchar(256),
	"size_mb" integer,
	"max_size_mb" integer,
	"org_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "port_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"port_number" integer NOT NULL,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"allocation_type" varchar(50) NOT NULL,
	"previous_port" integer,
	"allocation_reason" varchar(100),
	"allocated_by" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "port_conflicts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"port_number" integer NOT NULL,
	"conflict_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by_instance_id" integer,
	"requested_by_app_id" integer,
	"holding_instance_id" integer,
	"holding_app_id" integer,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolution_action" varchar(100),
	"resolution_timestamp" timestamp with time zone,
	"org_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "port_pool_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"pool_start" integer DEFAULT 10000 NOT NULL,
	"pool_end" integer DEFAULT 15000 NOT NULL,
	"sticky_allocation" boolean DEFAULT true NOT NULL,
	"allow_manual_assignment" boolean DEFAULT false NOT NULL,
	"auto_resolve_conflicts" boolean DEFAULT true NOT NULL,
	"fallback_strategy" varchar(50) DEFAULT 'next_available' NOT NULL,
	"alert_on_pool_usage_percent" integer DEFAULT 80 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"relation_type" text NOT NULL,
	"label" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_deployment_id" integer NOT NULL,
	"mission_run_id" integer NOT NULL,
	"success_rate" numeric(6, 5) DEFAULT '0' NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0',
	"efficiency_score" numeric(6, 5) DEFAULT '0',
	"ocean_traits_snapshot" jsonb DEFAULT '{}'::jsonb,
	"run_outcome" text,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"options" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_number" text NOT NULL,
	"opportunity_id" integer,
	"line_items" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "territories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rules" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "deployment_profile" text DEFAULT 'laptop' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "deployment_profile_overrides" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "mission_id" integer;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "tool_name" text;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "tool_args" jsonb;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "knowledge_node_id" integer;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD COLUMN "fallback_job_id" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "data_classification" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_properties" ADD COLUMN "deanon_config" jsonb;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "external_ticket_id" text;--> statement-breakpoint
ALTER TABLE "cycle_blueprints" ADD COLUMN "wave_index" integer;--> statement-breakpoint
ALTER TABLE "cycle_blueprints" ADD COLUMN "on_critical_path" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "cycle_dependency_gates" ADD COLUMN "timeout_ms" integer;--> statement-breakpoint
ALTER TABLE "cycle_dependency_gates" ADD COLUMN "escalation_state" text DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "cycle_dependency_gates" ADD COLUMN "escalated_to" text;--> statement-breakpoint
ALTER TABLE "operational_cycles" ADD COLUMN "execution_plan" jsonb;--> statement-breakpoint
ALTER TABLE "operational_cycles" ADD COLUMN "execution_policy" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "workflow_execution_id" integer;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "workflow_step_id" integer;--> statement-breakpoint
ALTER TABLE "scoring_events" ADD COLUMN "mission_run_id" integer;--> statement-breakpoint
ALTER TABLE "scoring_events" ADD COLUMN "agent_deployment_id" integer;--> statement-breakpoint
ALTER TABLE "memetic_graph" ADD COLUMN "mission_run_id" integer;--> statement-breakpoint
ALTER TABLE "blueprint_templates" ADD CONSTRAINT "blueprint_templates_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_templates" ADD CONSTRAINT "blueprint_templates_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_executions" ADD CONSTRAINT "template_executions_blueprint_template_id_blueprint_templates_id_fk" FOREIGN KEY ("blueprint_template_id") REFERENCES "public"."blueprint_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_executions" ADD CONSTRAINT "template_executions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_run_events" ADD CONSTRAINT "cycle_run_events_run_id_operational_cycles_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."operational_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_run_events" ADD CONSTRAINT "cycle_run_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_metrics" ADD CONSTRAINT "performance_metrics_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_logs" ADD CONSTRAINT "rate_limit_logs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version_history" ADD CONSTRAINT "skill_version_history_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_violations" ADD CONSTRAINT "policy_violations_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_accounts" ADD CONSTRAINT "sales_accounts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_opportunity_id_sales_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_contacts" ADD CONSTRAINT "sales_contacts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_contacts" ADD CONSTRAINT "sales_contacts_account_id_sales_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sales_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_forecasts" ADD CONSTRAINT "sales_forecasts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_prospect_lead_id_prospect_leads_id_fk" FOREIGN KEY ("prospect_lead_id") REFERENCES "public"."prospect_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_converted_account_id_sales_accounts_id_fk" FOREIGN KEY ("converted_account_id") REFERENCES "public"."sales_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_converted_contact_id_sales_contacts_id_fk" FOREIGN KEY ("converted_contact_id") REFERENCES "public"."sales_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_account_id_sales_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sales_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_lead_id_sales_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."sales_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_windows" ADD CONSTRAINT "sales_opportunity_windows_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_opportunity_windows" ADD CONSTRAINT "sales_opportunity_windows_opportunity_id_sales_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_quotas" ADD CONSTRAINT "sales_quotas_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_recommendations_domain" ADD CONSTRAINT "sales_recommendations_domain_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_recommendations_domain" ADD CONSTRAINT "sales_recommendations_domain_opportunity_id_sales_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stage_history" ADD CONSTRAINT "sales_stage_history_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stage_history" ADD CONSTRAINT "sales_stage_history_opportunity_id_sales_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_window_snapshots" ADD CONSTRAINT "sales_window_snapshots_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_window_snapshots" ADD CONSTRAINT "sales_window_snapshots_window_id_sales_opportunity_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."sales_opportunity_windows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_window_snapshots" ADD CONSTRAINT "sales_window_snapshots_opportunity_id_sales_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_agent_assignments" ADD CONSTRAINT "mission_agent_assignments_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_agent_assignments" ADD CONSTRAINT "mission_agent_assignments_agent_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consistency_remediation_config" ADD CONSTRAINT "consistency_remediation_config_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_consistency_log" ADD CONSTRAINT "state_consistency_log_instance_id_app_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."app_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_consistency_log" ADD CONSTRAINT "state_consistency_log_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_consistency_log" ADD CONSTRAINT "state_consistency_log_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_image_usage" ADD CONSTRAINT "container_image_usage_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_image_usage" ADD CONSTRAINT "container_image_usage_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_lifecycle_log" ADD CONSTRAINT "container_lifecycle_log_instance_id_app_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."app_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_lifecycle_log" ADD CONSTRAINT "container_lifecycle_log_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_lifecycle_log" ADD CONSTRAINT "container_lifecycle_log_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_volumes" ADD CONSTRAINT "container_volumes_instance_id_app_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."app_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_volumes" ADD CONSTRAINT "container_volumes_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "container_volumes" ADD CONSTRAINT "container_volumes_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_allocations" ADD CONSTRAINT "port_allocations_instance_id_app_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."app_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_allocations" ADD CONSTRAINT "port_allocations_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_allocations" ADD CONSTRAINT "port_allocations_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_conflicts" ADD CONSTRAINT "port_conflicts_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "port_pool_config" ADD CONSTRAINT "port_pool_config_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_edges" ADD CONSTRAINT "resource_edges_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_agent_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blueprint_templates_blueprint_id_idx" ON "blueprint_templates" USING btree ("blueprint_id");--> statement-breakpoint
CREATE INDEX "blueprint_templates_org_id_idx" ON "blueprint_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_templates_org_name_unique" ON "blueprint_templates" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "template_executions_template_id_idx" ON "template_executions" USING btree ("blueprint_template_id");--> statement-breakpoint
CREATE INDEX "template_executions_org_id_idx" ON "template_executions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "template_executions_pipeline_execution_id_idx" ON "template_executions" USING btree ("pipeline_execution_id");--> statement-breakpoint
CREATE INDEX "template_executions_status_idx" ON "template_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "template_executions_created_at_idx" ON "template_executions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "perf_metrics_execution_id_idx" ON "performance_metrics" USING btree ("pipeline_execution_id");--> statement-breakpoint
CREATE INDEX "perf_metrics_step_execution_id_idx" ON "performance_metrics" USING btree ("pipeline_step_execution_id");--> statement-breakpoint
CREATE INDEX "perf_metrics_org_id_idx" ON "performance_metrics" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "perf_metrics_created_at_idx" ON "performance_metrics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rate_limit_logs_org_id_idx" ON "rate_limit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "rate_limit_logs_user_id_idx" ON "rate_limit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rate_limit_logs_api_key_id_idx" ON "rate_limit_logs" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "rate_limit_logs_endpoint_idx" ON "rate_limit_logs" USING btree ("endpoint_path");--> statement-breakpoint
CREATE INDEX "rate_limit_logs_created_at_idx" ON "rate_limit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rate_limit_logs_exceeded_idx" ON "rate_limit_logs" USING btree ("limit_exceeded");--> statement-breakpoint
CREATE INDEX "idx_policy_violations_org" ON "policy_violations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_policy_violations_occurred_at" ON "policy_violations" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_policy_violations_check_type" ON "policy_violations" USING btree ("check_type");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_accounts_org_key_idx" ON "sales_accounts" USING btree ("organization_id","account_key");--> statement-breakpoint
CREATE INDEX "sales_accounts_org_name_idx" ON "sales_accounts" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "sales_accounts_external_crm_idx" ON "sales_accounts" USING btree ("external_crm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_activities_org_key_idx" ON "sales_activities" USING btree ("organization_id","activity_key");--> statement-breakpoint
CREATE INDEX "sales_activities_opportunity_idx" ON "sales_activities" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "sales_activities_occurred_at_idx" ON "sales_activities" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_contacts_org_key_idx" ON "sales_contacts" USING btree ("organization_id","contact_key");--> statement-breakpoint
CREATE INDEX "sales_contacts_account_idx" ON "sales_contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sales_contacts_email_idx" ON "sales_contacts" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_forecasts_org_key_idx" ON "sales_forecasts" USING btree ("organization_id","forecast_key");--> statement-breakpoint
CREATE INDEX "sales_forecasts_period_idx" ON "sales_forecasts" USING btree ("organization_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_leads_org_key_idx" ON "sales_leads" USING btree ("organization_id","lead_key");--> statement-breakpoint
CREATE INDEX "sales_leads_prospect_lead_idx" ON "sales_leads" USING btree ("prospect_lead_id");--> statement-breakpoint
CREATE INDEX "sales_leads_org_status_idx" ON "sales_leads" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_opportunities_org_key_idx" ON "sales_opportunities" USING btree ("organization_id","opportunity_key");--> statement-breakpoint
CREATE INDEX "sales_opportunities_account_idx" ON "sales_opportunities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sales_opportunities_org_stage_idx" ON "sales_opportunities" USING btree ("organization_id","stage");--> statement-breakpoint
CREATE INDEX "sales_opportunities_owner_idx" ON "sales_opportunities" USING btree ("organization_id","owner_rep");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_opportunity_windows_org_key_idx" ON "sales_opportunity_windows" USING btree ("organization_id","window_key");--> statement-breakpoint
CREATE INDEX "sales_opportunity_windows_opportunity_idx" ON "sales_opportunity_windows" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "sales_opportunity_windows_status_deadline_idx" ON "sales_opportunity_windows" USING btree ("status","next_gate_deadline");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_quotas_org_key_idx" ON "sales_quotas" USING btree ("organization_id","quota_key");--> statement-breakpoint
CREATE INDEX "sales_quotas_owner_period_idx" ON "sales_quotas" USING btree ("organization_id","owner_rep","period");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_recommendations_domain_org_key_idx" ON "sales_recommendations_domain" USING btree ("organization_id","recommendation_key");--> statement-breakpoint
CREATE INDEX "sales_recommendations_domain_opportunity_idx" ON "sales_recommendations_domain" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "sales_recommendations_domain_status_idx" ON "sales_recommendations_domain" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "sales_stage_history_opportunity_idx" ON "sales_stage_history" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "sales_stage_history_changed_at_idx" ON "sales_stage_history" USING btree ("organization_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_window_snapshots_org_key_idx" ON "sales_window_snapshots" USING btree ("organization_id","snapshot_key");--> statement-breakpoint
CREATE INDEX "sales_window_snapshots_window_idx" ON "sales_window_snapshots" USING btree ("window_id");--> statement-breakpoint
CREATE INDEX "sales_window_snapshots_taken_at_idx" ON "sales_window_snapshots" USING btree ("organization_id","taken_at");--> statement-breakpoint
CREATE INDEX "idx_maa_run" ON "mission_agent_assignments" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "idx_maa_agent" ON "mission_agent_assignments" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_maa_run_agent" ON "mission_agent_assignments" USING btree ("mission_run_id","agent_deployment_id");--> statement-breakpoint
CREATE INDEX "consistency_remediation_config_org_id_idx" ON "consistency_remediation_config" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "state_consistency_instance_id_idx" ON "state_consistency_log" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "state_consistency_check_timestamp_idx" ON "state_consistency_log" USING btree ("check_timestamp");--> statement-breakpoint
CREATE INDEX "state_consistency_org_id_idx" ON "state_consistency_log" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "state_consistency_divergence_type_idx" ON "state_consistency_log" USING btree ("divergence_type");--> statement-breakpoint
CREATE UNIQUE INDEX "container_image_usage_app_image_unq" ON "container_image_usage" USING btree ("app_id","image_name","image_tag");--> statement-breakpoint
CREATE INDEX "container_image_usage_app_image_idx" ON "container_image_usage" USING btree ("app_id","image_name");--> statement-breakpoint
CREATE INDEX "container_lifecycle_instance_timestamp_idx" ON "container_lifecycle_log" USING btree ("instance_id","operation_timestamp");--> statement-breakpoint
CREATE INDEX "container_lifecycle_operation_idx" ON "container_lifecycle_log" USING btree ("operation");--> statement-breakpoint
CREATE INDEX "container_lifecycle_status_idx" ON "container_lifecycle_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "container_lifecycle_org_idx" ON "container_lifecycle_log" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "container_volumes_instance_volume_unq" ON "container_volumes" USING btree ("instance_id","volume_name");--> statement-breakpoint
CREATE INDEX "container_volumes_volume_name_idx" ON "container_volumes" USING btree ("volume_name");--> statement-breakpoint
CREATE INDEX "container_volumes_instance_idx" ON "container_volumes" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "port_allocations_instance_port_unq" ON "port_allocations" USING btree ("instance_id","port_number");--> statement-breakpoint
CREATE INDEX "port_allocations_org_port_idx" ON "port_allocations" USING btree ("org_id","port_number");--> statement-breakpoint
CREATE INDEX "port_allocations_allocated_at_idx" ON "port_allocations" USING btree ("allocated_at");--> statement-breakpoint
CREATE INDEX "port_allocations_released_at_idx" ON "port_allocations" USING btree ("released_at");--> statement-breakpoint
CREATE INDEX "port_conflicts_port_timestamp_idx" ON "port_conflicts" USING btree ("port_number","conflict_timestamp");--> statement-breakpoint
CREATE INDEX "port_conflicts_resolved_idx" ON "port_conflicts" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "port_conflicts_org_idx" ON "port_conflicts" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "port_pool_config_org_unq" ON "port_pool_config" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "resource_edges_source_idx" ON "resource_edges" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "resource_edges_target_idx" ON "resource_edges" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "resource_edges_org_idx" ON "resource_edges" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_edges_org_relation_unique" ON "resource_edges" USING btree ("organization_id","source_type","source_id","relation_type","target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_ps_agent" ON "performance_snapshots" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE INDEX "idx_ps_run" ON "performance_snapshots" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "idx_ps_captured" ON "performance_snapshots" USING btree ("captured_at");--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_knowledge_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("knowledge_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_fallback_job_id_jobs_id_fk" FOREIGN KEY ("fallback_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Clean orphans for mission_runs.cycle_id
UPDATE mission_runs SET cycle_id = NULL
WHERE cycle_id IS NOT NULL AND cycle_id NOT IN (SELECT id FROM operational_cycles);--> statement-breakpoint
-- Clean orphans for pipeline_executions.mission_id
UPDATE pipeline_executions SET mission_id = NULL
WHERE mission_id IS NOT NULL AND mission_id NOT IN (SELECT id FROM missions);--> statement-breakpoint
-- Clean orphans for pipeline_executions.mission_run_id
UPDATE pipeline_executions SET mission_run_id = NULL
WHERE mission_run_id IS NOT NULL AND mission_run_id NOT IN (SELECT id FROM mission_runs);--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD CONSTRAINT "pipeline_executions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD CONSTRAINT "pipeline_executions_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD CONSTRAINT "mission_runs_cycle_id_operational_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."operational_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memetic_graph" ADD CONSTRAINT "memetic_graph_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_datasets_mission" ON "datasets" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "idx_approvals_knowledge" ON "approval_requests" USING btree ("knowledge_node_id");--> statement-breakpoint
CREATE INDEX "pipeline_steps_fallback_job_id_idx" ON "pipeline_steps" USING btree ("fallback_job_id");--> statement-breakpoint
CREATE INDEX "jobs_data_classification_idx" ON "jobs" USING btree ("organization_id","data_classification");--> statement-breakpoint
CREATE INDEX "idx_missions_ticket" ON "missions" USING btree ("external_ticket_id");--> statement-breakpoint
CREATE INDEX "knowledge_docs_workflow_execution_idx" ON "knowledge_documents" USING btree ("workflow_execution_id");--> statement-breakpoint
CREATE INDEX "knowledge_docs_workflow_step_idx" ON "knowledge_documents" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_run" ON "scoring_events" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_agent" ON "scoring_events" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE INDEX "idx_memetic_run" ON "memetic_graph" USING btree ("mission_run_id");