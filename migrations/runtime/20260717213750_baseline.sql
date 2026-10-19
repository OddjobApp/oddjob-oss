CREATE TYPE "public"."sales_activity_type" AS ENUM('REPLY', 'MEETING', 'DEMO', 'PROPOSAL_OPENED', 'CALL', 'EMAIL_SENT', 'STAGE_ADVANCED', 'NOTE');--> statement-breakpoint
CREATE TYPE "public"."sales_lead_status" AS ENUM('NEW', 'QUALIFYING', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED');--> statement-breakpoint
CREATE TYPE "public"."sales_rearm_effect" AS ENUM('HOLD', 'REBASELINE', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."sales_recommendation_kind" AS ENUM('slip_risk', 'stalled', 'aging', 'next_best_action', 'win', 'loss');--> statement-breakpoint
CREATE TYPE "public"."sales_recommendation_status" AS ENUM('OPEN', 'ACTED', 'SNOOZED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."sales_stage" AS ENUM('PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST');--> statement-breakpoint
CREATE TYPE "public"."sales_window_status" AS ENUM('ARMED', 'DECAYING', 'WON', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."antigravity_incident_status" AS ENUM('pending', 'investigating', 'resolved');--> statement-breakpoint
CREATE TABLE "admin_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text NOT NULL,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"knowledge_store_enabled" boolean DEFAULT true NOT NULL,
	"knowledge_graph_enabled" boolean DEFAULT true NOT NULL,
	"psychologist_enabled" boolean DEFAULT true NOT NULL,
	"skill_import_enabled" boolean DEFAULT false NOT NULL,
	"mcp_http_enabled" boolean DEFAULT false NOT NULL,
	"autoresearch_enabled" boolean DEFAULT true NOT NULL,
	"trustgraph_enabled" boolean DEFAULT true NOT NULL,
	"assistant_soul_traits" jsonb DEFAULT '{}'::jsonb,
	"assistant_soul_archetype" text,
	"allowed_agent_tools" text[],
	"allowed_job_types" text[],
	"embed_oauth_config" jsonb DEFAULT '{}'::jsonb,
	"profile_api_domain_allowlist" text[],
	"mission_concurrency" integer DEFAULT 1 NOT NULL,
	"monthly_budget_usd" numeric(10, 2) DEFAULT '100.00',
	"current_month_spend_usd" numeric(10, 2) DEFAULT '0.00',
	"budget_reset_day" integer DEFAULT 1 NOT NULL,
	"last_budget_reset_at" timestamp,
	"last_alert_threshold" integer DEFAULT 0,
	"last_alert_at" timestamp,
	"trycua_enabled" boolean DEFAULT false NOT NULL,
	"trycua_default_os" text DEFAULT 'linux' NOT NULL,
	"trycua_max_session_time" integer DEFAULT 60 NOT NULL,
	"deployment_profile" text DEFAULT 'laptop' NOT NULL,
	"deployment_profile_overrides" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"datasets_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_settings_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"org_id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"suppression_policy_id" integer,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text,
	"subscription_plan" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_policies" (
	"policy_id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"enable_quiet_hours" boolean DEFAULT true NOT NULL,
	"enable_severity_bypass" boolean DEFAULT false NOT NULL,
	"quiet_hours_bypass_severities" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"enable_user_filters" boolean DEFAULT true NOT NULL,
	"suppress_never_notify" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_policies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_orgs" (
	"user_id" text NOT NULL,
	"org_id" integer NOT NULL,
	CONSTRAINT "user_orgs_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"email" text,
	"first_name" text,
	"last_name" text,
	"default_org_id" integer,
	"quiet_hours_enabled" boolean,
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"quiet_hours_timezone" text,
	"alert_filters" jsonb,
	"slack_handle" text,
	"privacy_policy_accepted" boolean DEFAULT false NOT NULL,
	"privacy_policy_version" text,
	"tos_accepted" boolean DEFAULT false NOT NULL,
	"tos_version" text,
	"legal_accepted_at" timestamp,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"audit_id" serial PRIMARY KEY NOT NULL,
	"event_time" timestamp DEFAULT now() NOT NULL,
	"category" varchar(40) NOT NULL,
	"action" varchar(40) NOT NULL,
	"actor" text,
	"ref_type" varchar(40),
	"ref_id" integer,
	"ref_name" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"env_var_name" text NOT NULL,
	"metadata" jsonb,
	"organization_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" varchar(50) NOT NULL,
	"action" varchar(100),
	"method" varchar(10) NOT NULL,
	"url" text NOT NULL,
	"request_headers" jsonb,
	"request_body" jsonb,
	"response_status" integer,
	"response_body" jsonb,
	"error" text,
	"duration_ms" integer,
	"rate_limit_limit" integer,
	"rate_limit_remaining" integer,
	"rate_limit_reset" timestamp with time zone,
	"model" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" numeric(12, 6),
	"organization_id" integer,
	"user_id" text,
	"trace_id" text,
	"mission_id" integer,
	"is_priority" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_file_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_id" integer NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"size" bigint NOT NULL,
	"checksum" text NOT NULL,
	"storage_path" text NOT NULL,
	"change_description" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"mime_type" text,
	"size" bigint NOT NULL,
	"checksum" text,
	"description" text,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"version_count" integer DEFAULT 1 NOT NULL,
	"current_version_id" integer,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "system_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"license" text,
	"feature" text,
	"security_alerts_count" integer DEFAULT 0 NOT NULL,
	"vulnerability_details" jsonb DEFAULT '[]'::jsonb,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" integer
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"settings_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"organization_id" integer NOT NULL,
	"type" text DEFAULT 'partner' NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "api_specs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_url" text,
	"content" jsonb NOT NULL,
	"is_system_level" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_request_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"action" text NOT NULL,
	"method" text NOT NULL,
	"url" text NOT NULL,
	"request_headers" jsonb,
	"request_body" jsonb,
	"response_status" integer,
	"response_headers" jsonb,
	"response_body" jsonb,
	"duration_ms" integer,
	"organization_id" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_spec_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"spec_id" integer NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb
);
--> statement-breakpoint
CREATE TABLE "saas_connectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"platform" text NOT NULL,
	"base_url" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_id" integer,
	"last_sync" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saas_event_workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"platform" text NOT NULL,
	"trigger_event" text NOT NULL,
	"workflow_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transformation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saas_schema_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector_id" integer NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"fields" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saas_sync_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"connector_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_interval" integer DEFAULT 15 NOT NULL,
	"conflict_resolution" text DEFAULT 'last_write_wins' NOT NULL,
	"mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_daily_brief" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_channel_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text,
	"notify_missions" boolean DEFAULT true,
	"notify_jobs" boolean DEFAULT true,
	"notify_approvals" boolean DEFAULT true,
	"notify_collections" boolean DEFAULT true,
	"notify_apps" boolean DEFAULT true,
	"subscribed_mission_ids" jsonb,
	"subscribed_job_ids" jsonb,
	"subscribed_collection_ids" jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"command" text NOT NULL,
	"text" text,
	"response_url" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text,
	"user_id" text NOT NULL,
	"user_name" text,
	"team_id" text NOT NULL,
	"trigger_id" text,
	"response_status" text DEFAULT 'pending',
	"response_body" jsonb,
	"job_id" integer,
	"mission_id" integer,
	"collection_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_interactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"type" text NOT NULL,
	"action_id" text,
	"block_id" text,
	"callback_id" text,
	"user_id" text NOT NULL,
	"user_name" text,
	"channel_id" text,
	"channel_name" text,
	"team_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"action_type" text,
	"action_target_id" integer,
	"action_value" text,
	"processed_at" timestamp,
	"processed_result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"type" text NOT NULL,
	"channel_id" text NOT NULL,
	"thread_ts" text,
	"message_text" text,
	"message_blocks" jsonb,
	"job_id" integer,
	"mission_id" integer,
	"mission_run_id" integer,
	"collection_id" integer,
	"approval_request_id" integer,
	"slack_message_ts" text,
	"delivery_status" text DEFAULT 'pending',
	"error_message" text,
	"has_interactive_blocks" boolean DEFAULT false,
	"interactions_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "slack_user_contexts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"organization_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"bot_token" text NOT NULL,
	"user_token" text,
	"bot_user_id" text,
	"webhook_url" text,
	"webhook_channel" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"default_channel" text,
	"notify_on_mission_complete" boolean DEFAULT true,
	"notify_on_job_failure" boolean DEFAULT true,
	"notify_on_approval" boolean DEFAULT true,
	"notify_on_app_launched" boolean DEFAULT true,
	"installed_by" integer,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_workspaces_team_id_unique" UNIQUE("team_id")
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
CREATE TABLE "trycua_computer_use_task_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"step_number" integer NOT NULL,
	"phase" text NOT NULL,
	"status" text NOT NULL,
	"decision" text,
	"action" text,
	"observation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trycua_computer_use_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"task" text NOT NULL,
	"max_steps" integer DEFAULT 5 NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"require_confirmation" boolean DEFAULT true NOT NULL,
	"allow_sensitive" boolean DEFAULT false NOT NULL,
	"needs_confirmation" boolean DEFAULT false NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trycua_session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"action" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trycua_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"provider_session_id" text,
	"os" text DEFAULT 'linux' NOT NULL,
	"sandbox_name" text,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"mission_run_id" integer,
	"job_id" integer,
	"action_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"terminated_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"organization_id" integer,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"context_window" integer NOT NULL,
	"max_output_tokens" integer,
	"supports_streaming" boolean DEFAULT true,
	"supports_vision" boolean DEFAULT false,
	"supports_functions" boolean DEFAULT false,
	"supports_json_mode" boolean DEFAULT false,
	"quality_score" integer DEFAULT 80,
	"speed_score" integer DEFAULT 80,
	"cost_score" integer DEFAULT 80,
	"input_cost_per_1k" real,
	"output_cost_per_1k" real,
	"priority" integer DEFAULT 100,
	"is_active" boolean DEFAULT true,
	"is_default" boolean DEFAULT false,
	"capabilities" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_provider_health" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"success_rate" real DEFAULT 100,
	"avg_latency_ms" integer,
	"error_rate" real DEFAULT 0,
	"status" text DEFAULT 'healthy',
	"last_checked_at" timestamp DEFAULT now(),
	"last_error_at" timestamp,
	"last_error_message" text,
	"consecutive_failures" integer DEFAULT 0,
	"circuit_open" boolean DEFAULT false,
	"circuit_open_until" timestamp,
	"requests_count" integer DEFAULT 0,
	"tokens_count" integer DEFAULT 0,
	"errors_count" integer DEFAULT 0,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"api_key" text NOT NULL,
	"api_endpoint" text,
	"supports_streaming" boolean DEFAULT true,
	"supports_vision" boolean DEFAULT false,
	"supports_functions" boolean DEFAULT false,
	"supports_json_mode" boolean DEFAULT false,
	"max_requests_per_minute" integer DEFAULT 60,
	"max_tokens_per_minute" integer DEFAULT 100000,
	"max_concurrent_requests" integer DEFAULT 10,
	"is_active" boolean DEFAULT true,
	"priority" integer DEFAULT 100,
	"default_input_cost_per_1k" real DEFAULT 0,
	"default_output_cost_per_1k" real DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_router_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"request_id" text NOT NULL,
	"job_id" integer,
	"job_run_id" integer,
	"selected_provider_id" integer,
	"selected_model_id" integer,
	"routing_rule_id" integer,
	"routing_strategy" text NOT NULL,
	"request_params" jsonb,
	"required_capabilities" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost" real,
	"latency_ms" integer,
	"time_to_first_token_ms" integer,
	"success" boolean,
	"error_message" text,
	"error_code" text,
	"response_content" text,
	"was_fallback" boolean DEFAULT false,
	"fallback_attempt" integer DEFAULT 0,
	"previous_attempt_ids" jsonb,
	"mtp_enabled" boolean DEFAULT false,
	"mtp_speedup_pct" double precision,
	"mtp_accuracy_pct" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "llm_router_logs_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "llm_routing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" text NOT NULL,
	"description" text,
	"priority" integer DEFAULT 100,
	"is_active" boolean DEFAULT true,
	"required_capabilities" jsonb,
	"min_quality_score" integer,
	"max_cost_per_1k" real,
	"preferred_providers" jsonb,
	"excluded_providers" jsonb,
	"target_model_id" integer,
	"fallback_enabled" boolean DEFAULT true,
	"fallback_models" jsonb,
	"max_retries" integer DEFAULT 3,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encrypted_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"credential_type" text NOT NULL,
	"encrypted_data" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_spend_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"total_spend_usd" numeric(10, 2) NOT NULL,
	"budget_limit_usd" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_licenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"plan_type" text NOT NULL,
	"seats" text NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"customer_name" text,
	"issued_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"last_validated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_licenses_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "entity_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_summary" text,
	"changed_fields" jsonb,
	"user_id" text,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_locks" (
	"scheduled_job_id" integer PRIMARY KEY NOT NULL,
	"in_progress" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_execution_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheduled_job_id" integer NOT NULL,
	"trigger_id" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"error_details" jsonb,
	"result" jsonb,
	"execution_type" text DEFAULT 'job' NOT NULL,
	"job_run_id" integer,
	"pipeline_run_id" integer,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_triggers" (
	"trigger_id" serial PRIMARY KEY NOT NULL,
	"scheduled_job_id" integer NOT NULL,
	"next_fire_at" timestamp NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"scheduled_job_id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"job_id" integer,
	"pipeline_id" integer,
	"mission_id" integer,
	"schedule_id" integer,
	"priority" integer DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"alert_on_failure" boolean DEFAULT true NOT NULL,
	"alert_on_success" boolean DEFAULT false NOT NULL,
	"alert_on_delay" boolean DEFAULT true NOT NULL,
	"delay_threshold" integer DEFAULT 15 NOT NULL,
	"max_concurrent_runs" integer DEFAULT 1 NOT NULL,
	"queue_timeout" integer DEFAULT 60 NOT NULL,
	"trigger_type" text DEFAULT 'Schedule' NOT NULL,
	"trigger_credential_id" integer,
	"max_retries" integer DEFAULT 0 NOT NULL,
	"retry_delay_seconds" integer DEFAULT 60 NOT NULL,
	"catchup_policy" text,
	"parameter_values" jsonb,
	"sla_minutes" integer,
	"escalation_policy" jsonb,
	"organization_id" integer,
	"created_by" text,
	"created_by_user_id" text,
	"owner_user_id" text,
	"owner_org_id" integer,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"schedule_id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"pattern" integer NOT NULL,
	"timezone" text,
	"pattern_string" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pattern_label" text,
	"calendar_id" integer,
	"on_holiday_behavior" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "error_alert_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT true,
	"error_categories" text[],
	"min_occurrences" integer DEFAULT 3,
	"time_window_minutes" integer DEFAULT 60,
	"pipeline_ids" integer[],
	"notify_via" text[] NOT NULL,
	"slack_webhook_url" text,
	"slack_channel" varchar(255),
	"email_recipients" text[],
	"cooldown_minutes" integer DEFAULT 30,
	"last_triggered_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "error_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" integer,
	"triggered_at" timestamp DEFAULT now(),
	"error_count" integer NOT NULL,
	"error_category" varchar(50),
	"pipeline_id" integer,
	"diagnosis_summary" jsonb,
	"sample_errors" text[],
	"notification_sent" boolean DEFAULT false,
	"notification_error" text
);
--> statement-breakpoint
CREATE TABLE "error_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"description" text,
	"error_count" integer DEFAULT 0,
	"sample_errors" text[],
	"suggested_pattern" jsonb,
	"centroid_text" text,
	"status" varchar(50) DEFAULT 'pending',
	"organization_id" integer,
	"reviewed_by" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "error_diagnoses" (
	"id" serial PRIMARY KEY NOT NULL,
	"diagnosis_id" varchar(36) NOT NULL,
	"pipeline_execution_id" integer,
	"step_execution_id" integer,
	"error_message" text,
	"error_code" varchar(50),
	"http_status" integer,
	"job_type" varchar(50),
	"matched_pattern_id" varchar(255),
	"matched_pattern_score" integer,
	"ai_diagnosis" jsonb,
	"recommendations" jsonb,
	"applied_fix_id" varchar(255),
	"fix_successful" boolean,
	"user_feedback" varchar(50),
	"organization_id" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "error_diagnoses_diagnosis_id_unique" UNIQUE("diagnosis_id")
);
--> statement-breakpoint
CREATE TABLE "error_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"error_diagnosis_id" varchar(36),
	"error_text" text NOT NULL,
	"error_hash" varchar(64),
	"cluster_id" integer,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "forensic_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"trace_id" varchar(32),
	"span_id" varchar(16),
	"parent_span_id" varchar(16),
	"organization_id" integer,
	"user_id" varchar(255),
	"job_type" varchar(50) NOT NULL,
	"job_id" integer,
	"pipeline_id" integer,
	"mission_run_id" integer,
	"step_execution_id" integer,
	"start_time_ns" bigint NOT NULL,
	"end_time_ns" bigint,
	"status" varchar(20) NOT NULL,
	"error_message" text,
	"error_stack" text,
	"rag_topic_id" integer,
	"knowledge_node_refs" text[],
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"thoughts" text,
	"reasoning_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"organization_id" integer,
	"ip_address" varchar(45),
	"user_agent" text,
	"action" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(255),
	"changes" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reasoning_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_run_id" integer,
	"trace_id" varchar(32) NOT NULL,
	"reasoning_protocol" varchar(20),
	"raw_reasoning" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending',
	"auditor_id" varchar(255),
	"audit_notes" text,
	"violated_policies" text[],
	"severity" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"alert_id" serial PRIMARY KEY NOT NULL,
	"severity" varchar(10) NOT NULL,
	"category" varchar(50) NOT NULL,
	"job_run_id" integer,
	"scheduled_job_id" integer,
	"pipeline_run_id" integer,
	"message" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	"resolved_at" timestamp,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"owner_user_id" text,
	"owner_org_id" integer,
	"suppressed" boolean DEFAULT false NOT NULL,
	"suppressed_reason" text,
	"suppressed_until" timestamp,
	"updated_at" timestamp
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
CREATE TABLE "pipeline_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text NOT NULL,
	"trigger_credential_id" integer,
	"labels" jsonb,
	"is_active" boolean DEFAULT true,
	"organization_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"current_version" integer DEFAULT 1,
	"monthly_budget_usd" numeric(10, 2),
	"enable_knowledge_graph" boolean DEFAULT false NOT NULL,
	"knowledge_graph_config" jsonb,
	"lifecycle_status" text DEFAULT 'active' NOT NULL,
	"governor_settings" jsonb,
	"governor_policy_id" integer,
	"baseline_run_id" integer,
	"baseline_output" jsonb,
	"self_healing_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_id" integer NOT NULL,
	"job_id" integer,
	"order" integer NOT NULL,
	"output_name" text,
	"run_on_condition" text DEFAULT 'on_success' NOT NULL,
	"wait_duration_seconds" integer DEFAULT 0,
	"on_failure_action" text DEFAULT 'Stop Pipeline' NOT NULL,
	"fallback_job_id" integer,
	"parallel_group" text,
	"condition_expression" text,
	"module_type" text,
	"destination_step_id" integer,
	"decision_node_config" jsonb,
	"knowledge_graph_config" jsonb,
	"retry_config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expected_input_schema" jsonb,
	"guaranteed_output_schema" jsonb,
	"tool_name" text,
	"tool_arguments" jsonb,
	"forge_config" jsonb
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_id" integer,
	"user_id" text,
	"execution_id" integer,
	"step_execution_id" integer,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_uuid" text DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"error" text,
	"organization_id" integer,
	"created_by" text NOT NULL,
	"start_step_id" integer,
	"ttl" integer,
	"trace_id" varchar(32),
	"sampling_rate" numeric(3, 2) DEFAULT '1.00',
	"trace_source" varchar(20),
	"last_heartbeat" timestamp,
	"parent_execution_id" integer,
	"mission_id" integer,
	"mission_run_id" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"context_snapshot" jsonb,
	"is_shadow" boolean DEFAULT false NOT NULL,
	"estimated_time_remaining_ms" integer,
	"last_etc_calculation_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pipeline_step_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_execution_id" integer NOT NULL,
	"pipeline_step_id" integer NOT NULL,
	"job_id" integer,
	"step_order" integer NOT NULL,
	"run_group" text,
	"idempotency_key" text,
	"trace_id" text,
	"output_uri" text,
	"error_uri" text,
	"output_name" text,
	"output" text,
	"error" text,
	"status" text NOT NULL,
	"executed_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"span_id" varchar(16),
	"parent_span_id" varchar(16),
	"trace_flags" varchar(2) DEFAULT '01',
	"retry_count" integer DEFAULT 0,
	"parent_step_execution_id" integer,
	"output_schema" jsonb,
	"execution_stats" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"sleep_until" timestamp,
	"suspension_metadata" jsonb,
	"dependency_status" varchar(20),
	"dependency_resolution_time" timestamp,
	"diff" jsonb,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pipeline_triggers" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"filter_condition" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"debounce_window" integer DEFAULT 0,
	"batch_size" integer DEFAULT 1,
	"map_payload" boolean DEFAULT false,
	"payload_mapping" jsonb,
	"verification_mode" text DEFAULT 'none',
	"verification_config" jsonb,
	"action_type" text DEFAULT 'pipeline' NOT NULL,
	"notification_config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_trigger_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"pipeline_id" integer,
	"trigger_id" integer,
	"event_id" text,
	"event_type" text NOT NULL,
	"event_payload" jsonb,
	"evaluation_result" boolean NOT NULL,
	"filter_condition" text,
	"outcome" text NOT NULL,
	"execution_id" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drift_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"pipeline_id" integer,
	"execution_id" integer,
	"step_id" text,
	"drift_score" double precision NOT NULL,
	"drift_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "job_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"depends_on_job_id" integer NOT NULL,
	"dependency_type" varchar(20) DEFAULT 'hard' NOT NULL,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"is_hidden" boolean DEFAULT false,
	"tool" text DEFAULT 'None' NOT NULL,
	"config" jsonb NOT NULL,
	"priority" integer DEFAULT 2,
	"is_active" boolean DEFAULT true,
	"lifecycle_status" text DEFAULT 'active' NOT NULL,
	"parameter_schema" jsonb,
	"render_template" text,
	"cpu_limit_millicores" integer,
	"memory_limit_mb" integer,
	"organization_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_tested_at" timestamp,
	"last_test_status" text,
	"output_storage_enabled" boolean DEFAULT false NOT NULL,
	"enable_knowledge_store" boolean DEFAULT false NOT NULL,
	"output_knowledge_topic_id" integer,
	"output_dataset_id" integer,
	"output_tags" text[] DEFAULT ARRAY[]::text[],
	"output_storage_settings" jsonb,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"test_config" jsonb,
	"diff_config" jsonb DEFAULT '{}'::jsonb,
	"governor_settings" jsonb,
	"governor_policy_id" integer,
	"data_classification" text DEFAULT 'public' NOT NULL,
	"default_target_metric" jsonb,
	"skill_id" integer
);
--> statement-breakpoint
CREATE TABLE "job_request_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"organization_id" integer,
	"request_method" text,
	"request_url" text,
	"request_headers" jsonb,
	"request_body" jsonb,
	"request_params" jsonb,
	"response_status" integer,
	"response_headers" jsonb,
	"response_body" jsonb,
	"response_time_ms" integer,
	"triggered_by" text DEFAULT 'manual' NOT NULL,
	"triggered_by_user_id" integer,
	"execution_context" jsonb,
	"is_replayable" integer DEFAULT 1 NOT NULL,
	"replay_of_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_token_daily_aggregation" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"total_requests" integer DEFAULT 0 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost" real DEFAULT 0 NOT NULL,
	"model_breakdown" jsonb,
	"job_breakdown" jsonb
);
--> statement-breakpoint
CREATE TABLE "ai_token_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"job_run_id" integer,
	"organization_id" integer,
	"model_provider" text NOT NULL,
	"model_name" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"input_cost" real DEFAULT 0 NOT NULL,
	"output_cost" real DEFAULT 0 NOT NULL,
	"total_cost" real DEFAULT 0 NOT NULL,
	"request_timestamp" timestamp DEFAULT now() NOT NULL,
	"latency_ms" integer,
	"prompt_type" text,
	"prompt_category" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "job_active_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"job_run_id" integer NOT NULL,
	"organization_id" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"sse_channel_id" text,
	"triggered_by" text DEFAULT 'manual',
	"context" text
);
--> statement-breakpoint
CREATE TABLE "job_streaming_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"job_run_id" integer NOT NULL,
	"organization_id" integer,
	"log_level" text DEFAULT 'info' NOT NULL,
	"log_type" text DEFAULT 'stdout' NOT NULL,
	"message" text NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"is_final_chunk" integer DEFAULT 0 NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "hil_approval_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"organization_id" integer,
	"request_hash" text NOT NULL,
	"request_summary" text,
	"request_context" jsonb,
	"total_requests" integer DEFAULT 0 NOT NULL,
	"approved_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"avg_approval_time_minutes" integer,
	"common_modifiers" jsonb,
	"is_reliable_pattern" integer DEFAULT 0,
	"reliability_score" integer DEFAULT 0,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hil_escalation_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"approval_request_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"escalation_type" text NOT NULL,
	"from_user_id" integer,
	"to_user_ids" jsonb,
	"to_role" text,
	"reason" text,
	"escalated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "hil_job_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"organization_id" integer,
	"escalation_enabled" integer DEFAULT 1 NOT NULL,
	"escalation_timeout_minutes" integer DEFAULT 60 NOT NULL,
	"escalation_role" text DEFAULT 'admin',
	"escalation_user_ids" jsonb,
	"allow_delegation" integer DEFAULT 0 NOT NULL,
	"delegatable_to_roles" jsonb,
	"auto_approval_enabled" integer DEFAULT 0 NOT NULL,
	"auto_approval_rules" jsonb,
	"similarity_threshold" integer DEFAULT 90,
	"business_hours_only" integer DEFAULT 0 NOT NULL,
	"business_hours_timezone" text DEFAULT 'UTC',
	"business_hours_start" integer DEFAULT 9,
	"business_hours_end" integer DEFAULT 17,
	"notify_on_pending" jsonb,
	"notify_on_escalation" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hil_job_config_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "agent_critiques" (
	"id" serial PRIMARY KEY NOT NULL,
	"interaction_id" integer NOT NULL,
	"criticism" text NOT NULL,
	"score" integer NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb,
	"correction" text,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now()
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
CREATE TABLE "agent_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer,
	"job_id" integer,
	"user_id" text NOT NULL,
	"session_id" text,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"rating" integer DEFAULT 0,
	"feedback" text,
	"feedback_reason" text,
	"effectiveness_score" integer DEFAULT 0,
	"embedding" text,
	"mission_id" integer,
	"organization_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "agent_response_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer,
	"name" text NOT NULL,
	"scenario" text,
	"user_query" text NOT NULL,
	"preferred_response" text NOT NULL,
	"reasoning" text,
	"effectiveness_score" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"job_id" integer,
	"organization_id" integer,
	"user_id" text,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"tool_name" text,
	"tool_args" jsonb,
	"mission_id" integer,
	"mission_run_id" integer,
	"confidence" integer,
	"step_index" integer,
	"action" text,
	"selector" text,
	"value" text,
	"optional" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_tool_hints" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"pipeline_id" integer,
	"tool_name" text,
	"prompt_pattern" text NOT NULL,
	"hint_text" text NOT NULL,
	"source_message_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimization_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer,
	"run_id" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"reasoning" text,
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reference_test" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer
);
--> statement-breakpoint
CREATE TABLE "agent_tool_examples" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_name" varchar(255) NOT NULL,
	"task_type" varchar(255) NOT NULL,
	"example_prompt" text NOT NULL,
	"example_output" text NOT NULL,
	"success_score" real DEFAULT 1 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_tool_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_run_id" integer,
	"execution_id" integer,
	"tool_name" varchar(255) NOT NULL,
	"task_type" varchar(255),
	"task_description" text,
	"status" varchar(50) NOT NULL,
	"execution_time_ms" integer,
	"error_type" varchar(255),
	"error_message" text,
	"input_params" jsonb,
	"output_data" jsonb,
	"reasoning" text,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transaction_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"execution_id" integer,
	"operation_type" varchar(100) NOT NULL,
	"operation_params" jsonb NOT NULL,
	"rollback_data" jsonb,
	"status" varchar(50) DEFAULT 'pending',
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"rolled_back_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mission_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"mission_run_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"suggested_action" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"applied_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ml_strategy_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"predicted_strategy" varchar(50) NOT NULL,
	"confidence" real NOT NULL,
	"expected_success_rate" real NOT NULL,
	"task_features" jsonb NOT NULL,
	"actual_strategy" varchar(50),
	"actual_success" boolean,
	"actual_quality" real,
	"accuracy_delta" real,
	"agent_id" varchar(100) NOT NULL,
	"organization_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_model_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" varchar(20) NOT NULL,
	"feature_weights" jsonb NOT NULL,
	"training_records_count" integer NOT NULL,
	"validation_accuracy" real NOT NULL,
	"avg_prediction_confidence" real,
	"avg_actual_success_rate" real,
	"organization_id" integer NOT NULL,
	"trained_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT false,
	CONSTRAINT "strategy_model_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "strategy_performance_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"strategy" varchar(50) NOT NULL,
	"task_features" jsonb NOT NULL,
	"success" boolean NOT NULL,
	"quality_score" real NOT NULL,
	"execution_time_ms" integer NOT NULL,
	"token_usage" integer NOT NULL,
	"correction_count" integer DEFAULT 0,
	"agent_id" varchar(100) NOT NULL,
	"organization_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conduct_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"description" text NOT NULL,
	"mission_id" integer,
	"execution_id" integer,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_pips" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"organization_id" integer,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"reason" text NOT NULL,
	"failure_threshold" real DEFAULT 0.3 NOT NULL,
	"current_error_rate" real DEFAULT 0,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"metrics" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "agent_long_term_memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"user_id" text,
	"type" text NOT NULL,
	"key" text,
	"content" text NOT NULL,
	"importance" integer DEFAULT 5,
	"source" text DEFAULT 'manual' NOT NULL,
	"confidence" integer DEFAULT 100 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_platform_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" integer NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"platform_username" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "knowledge_base_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"repository_id" text NOT NULL,
	"question_text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger_source" text NOT NULL,
	"context_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposed_answer" text,
	"answer_text" text,
	"answered_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "reflection_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"mission_run_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"step_id" text NOT NULL,
	"original_output" jsonb NOT NULL,
	"output_type" text DEFAULT 'unknown',
	"reflection_result" jsonb NOT NULL,
	"correction_attempted" boolean DEFAULT false,
	"corrected_output" jsonb,
	"correction_strategy" text,
	"retry_count" integer DEFAULT 0,
	"max_retries" integer DEFAULT 3,
	"resolution" text NOT NULL,
	"resolution_reason" text,
	"processing_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reflection_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"pattern_type" text NOT NULL,
	"trigger_signature" text NOT NULL,
	"signature_algorithm" text DEFAULT 'issue-hash',
	"name" text,
	"description" text,
	"example" text,
	"correction_strategy" jsonb NOT NULL,
	"times_detected" integer DEFAULT 1,
	"times_corrected" integer DEFAULT 0,
	"times_escalated" integer DEFAULT 0,
	"success_rate" numeric(5, 2) DEFAULT '0',
	"first_detected_at" timestamp DEFAULT now() NOT NULL,
	"last_detected_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_from_log_id" text,
	"is_auto_generated" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "reflection_stats_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"date" timestamp NOT NULL,
	"total_reflections" integer DEFAULT 0,
	"passed_count" integer DEFAULT 0,
	"corrected_count" integer DEFAULT 0,
	"escalated_count" integer DEFAULT 0,
	"failed_count" integer DEFAULT 0,
	"avg_confidence_score" numeric(5, 2),
	"avg_processing_time_ms" integer,
	"avg_retry_count" numeric(3, 1),
	"hallucination_count" integer DEFAULT 0,
	"logical_error_count" integer DEFAULT 0,
	"factual_error_count" integer DEFAULT 0,
	"schema_mismatch_count" integer DEFAULT 0,
	"inconsistency_count" integer DEFAULT 0,
	"total_tokens_used" integer,
	"estimated_cost_usd" numeric(10, 4),
	"calculated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"welcome_message" text,
	"branding_config" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"access_policy" text DEFAULT 'public',
	"access_password_hash" text,
	"allowed_file_types" text[],
	"max_file_size_mb" integer DEFAULT 10,
	"allowed_topic_ids" integer[],
	"allowed_dataset_ids" integer[],
	"allowed_pipeline_ids" integer[],
	"allowed_tools" text[],
	"form_manifest" jsonb DEFAULT '{}'::jsonb,
	"embed_config" jsonb DEFAULT '{}'::jsonb,
	"ocean_traits" jsonb DEFAULT '{"o": 0.5, "c": 0.5, "e": 0.5, "a": 0.5, "n": 0.5}'::jsonb,
	"soul_archetype" text DEFAULT 'Lead Directive',
	"legend" text,
	"reports_to_id" integer,
	"org_role" text DEFAULT 'worker',
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"goal" text NOT NULL,
	"progress" jsonb,
	"status" text NOT NULL,
	"next_wake_up" timestamp,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "pipeline_input_params" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_id" integer NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"description" text,
	"data_type" text NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"default_value" text,
	"min_length" integer,
	"max_length" integer,
	"pattern" text,
	"pattern_message" text,
	"min_value" numeric(20, 6),
	"max_value" numeric(20, 6),
	"allowed_values" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_output_params" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipeline_id" integer NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"description" text,
	"data_type" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"schema_def" jsonb,
	"sample_value" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_collection_items" (
	"collection_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	CONSTRAINT "job_collection_items_collection_id_job_id_pk" PRIMARY KEY("collection_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "job_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"mission_id" integer,
	"tags" jsonb,
	"template_id" text,
	"template_data" jsonb,
	"is_smart" integer DEFAULT 0,
	"smart_rules" jsonb,
	"governor_settings" jsonb,
	"security_report" jsonb
);
--> statement-breakpoint
CREATE TABLE "mission_collection_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"mission_run_id" integer NOT NULL,
	"collection_id" integer NOT NULL,
	"triggered_by" text NOT NULL,
	"execution_type" text DEFAULT 'test' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"results" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer,
	"organization_id" integer
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
CREATE TABLE "skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"language" text DEFAULT 'javascript' NOT NULL,
	"code" text NOT NULL,
	"is_installed" boolean DEFAULT true NOT NULL,
	"install_command" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"organization_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skills_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "shortlink_clicks" (
	"id" serial PRIMARY KEY NOT NULL,
	"shortlink_id" integer NOT NULL,
	"clicked_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"referrer" text,
	"country" text,
	"city" text,
	"device_type" text,
	"browser" text,
	"os" text
);
--> statement-breakpoint
CREATE TABLE "shortlinks" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"resource_type" text DEFAULT 'agent' NOT NULL,
	"resource_id" text NOT NULL,
	"organization_id" integer NOT NULL,
	"target_path" text,
	"title" text,
	"description" text,
	"qr_code_data_url" text,
	"qr_code_generated_at" timestamp,
	"click_count" integer DEFAULT 0,
	"last_clicked_at" timestamp,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true,
	"qr_code_color" text DEFAULT '#000000',
	"qr_code_bg_color" text DEFAULT '#FFFFFF',
	"qr_code_size" integer DEFAULT 400,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_salaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"session_id" text NOT NULL,
	"organization_id" integer,
	"budget_tokens" integer DEFAULT 100000 NOT NULL,
	"current_spend_tokens" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governor_consensus_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"command_hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"consensus_score" numeric(5, 3),
	"outcome" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governor_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" integer,
	"type" text DEFAULT 'custom' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governor_policy_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" integer NOT NULL,
	"type" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_spend_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"organization_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"reason" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_agent_salaries" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"agent_id" text NOT NULL,
	"organization_id" integer NOT NULL,
	"token_allowance" integer DEFAULT 50000 NOT NULL,
	"current_spend" integer DEFAULT 0 NOT NULL,
	"lifetime_spend" integer DEFAULT 0 NOT NULL,
	"efficiency_score" numeric(6, 5) DEFAULT '0' NOT NULL,
	"last_evaluation_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_approvals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" integer NOT NULL,
	"type" text NOT NULL,
	"requester_id" text NOT NULL,
	"mission_id" integer,
	"manifest_id" text,
	"projected_cost" integer DEFAULT 0 NOT NULL,
	"current_spend" integer DEFAULT 0 NOT NULL,
	"budget_limit" integer DEFAULT 0 NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"required_by" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_budget_policies" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" integer NOT NULL,
	"department" text,
	"monthly_limit" integer DEFAULT 100000 NOT NULL,
	"alert_threshold" numeric(5, 3) DEFAULT '0.800' NOT NULL,
	"hard_limit" integer DEFAULT 150000 NOT NULL,
	"currency" text DEFAULT 'tokens' NOT NULL,
	"reset_day" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "agent_policy_bundles" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "agent_performances" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"organization_id" integer NOT NULL,
	"total_missions" integer DEFAULT 0 NOT NULL,
	"successful_missions" integer DEFAULT 0 NOT NULL,
	"failed_missions" integer DEFAULT 0 NOT NULL,
	"success_rate" numeric(6, 5) DEFAULT '0' NOT NULL,
	"total_cost" integer DEFAULT 0 NOT NULL,
	"avg_cost_per_mission" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost_per_success" numeric(12, 2) DEFAULT '0' NOT NULL,
	"efficiency_score" numeric(6, 5) DEFAULT '0' NOT NULL,
	"trend" text DEFAULT 'stable' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"first_mission_at" timestamp with time zone,
	"last_mission_at" timestamp with time zone,
	"last_evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_upskilling_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"pip_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"type" text NOT NULL,
	"dataset_id" text,
	"model_id" text,
	"external_job_id" text,
	"progress_percent" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_improvement_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"organization_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_days" integer DEFAULT 14 NOT NULL,
	"target_success_rate" numeric(6, 5) DEFAULT '0.80000' NOT NULL,
	"target_cost_efficiency" numeric(12, 2) DEFAULT '0' NOT NULL,
	"trigger_reason" text,
	"threshold_failed" text,
	"upskilling_attempts" integer DEFAULT 0 NOT NULL,
	"retraining_sessions" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"outcome" text,
	"final_success_rate" numeric(6, 5),
	"final_cost_efficiency" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"job_id" integer,
	"tool_name" text,
	"tool_args" jsonb,
	"approver_type" text NOT NULL,
	"approver_id" text,
	"approver_email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_at" timestamp,
	"comments" text,
	"modified_output" jsonb,
	"selection_list" jsonb,
	"organization_id" integer,
	"token" text NOT NULL,
	"is_evolutionary" boolean DEFAULT false,
	"snoozed_until" timestamp,
	"mission_id" integer,
	"knowledge_node_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hil_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'HIL Form' NOT NULL,
	"description" text,
	"schema" jsonb DEFAULT '{"fields":[]}'::jsonb NOT NULL,
	"theme_config" jsonb DEFAULT '{"logoUrl":"","primaryColor":"#4F46E5","companyName":"Oddjob"}'::jsonb,
	"security_config" jsonb DEFAULT '{"requireOtp":false,"tokenExpirationHours":48}'::jsonb,
	"organization_id" integer,
	"is_archived" boolean DEFAULT false,
	"is_viewed" boolean DEFAULT false,
	"step_execution_id" integer,
	"status" text DEFAULT 'pending',
	"config" jsonb DEFAULT '{}'::jsonb,
	"data" jsonb,
	"submitted_by" text,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"email" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" text NOT NULL,
	"description" text,
	"transport" text DEFAULT 'stdio' NOT NULL,
	"command" text,
	"args" jsonb,
	"env" jsonb,
	"url" text,
	"status" text DEFAULT 'inactive' NOT NULL,
	"last_connected_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" integer NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resource_scoping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"last_used_ip" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"description" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"user_email" text NOT NULL,
	"priority" text DEFAULT 'normal',
	"status" text DEFAULT 'open',
	"sentiment_score" integer,
	"sentiment_label" text,
	"category" text,
	"confidence_score" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "prospect_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer,
	"profile_id" integer NOT NULL,
	"session_id" text NOT NULL,
	"activity" text NOT NULL,
	"url" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"bant_score" jsonb DEFAULT '{"S":0,"C":0,"O":0,"R":0,"E":0}'::jsonb NOT NULL,
	"status" text DEFAULT 'anonymous' NOT NULL,
	"last_score_update" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer,
	"uid" text NOT NULL,
	"user_id" text,
	"attributed_themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributed_concepts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_profiles_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
CREATE TABLE "prospect_properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"uid" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"persona_agent_id" text,
	"persona_prompt_override" text,
	"ui_config" jsonb DEFAULT '{"hydration":"on_intervention"}'::jsonb NOT NULL,
	"deanon_config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_properties_uid_unique" UNIQUE("uid")
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
CREATE TABLE "antigravity_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_run_id" integer NOT NULL,
	"description" text NOT NULL,
	"context" jsonb NOT NULL,
	"status" "antigravity_incident_status" DEFAULT 'pending' NOT NULL,
	"trace_id" text,
	"resolution" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_blackboard_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"mission_run_id" integer,
	"blackboard" jsonb NOT NULL,
	"changed_by" text NOT NULL,
	"change_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'supervisor_led' NOT NULL,
	"organization_id" integer,
	"parent_id" integer,
	"objective" text,
	"capability_contract" jsonb,
	"blackboard" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget_limit_usd" numeric(10, 2) DEFAULT '5.00',
	"current_spend_usd" numeric(10, 2) DEFAULT '0.00',
	"governor_policy_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"is_scheduled" boolean DEFAULT false NOT NULL,
	"schedule_id" integer,
	"execution_strategy" text DEFAULT 'pre_planned' NOT NULL,
	"reasoning_protocol" text DEFAULT 'json_manifest' NOT NULL,
	"dynamic_cycle_budget_limit_usd" numeric(10, 2) DEFAULT '5.00',
	"hil_strictness" text DEFAULT 'moderate',
	"hil_notification_channels" jsonb DEFAULT '["inbox"]'::jsonb,
	"target_metric" jsonb,
	"human_steering_nudge" text,
	"is_shadow_mode" boolean DEFAULT false NOT NULL,
	"auto_synthesis" boolean DEFAULT false NOT NULL,
	"recursive_optimization" boolean DEFAULT false NOT NULL,
	"evaluation_consensus_threshold" integer DEFAULT 2 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"is_draft" boolean DEFAULT false NOT NULL,
	"workflow_blueprint" jsonb,
	"context_core_url" text,
	"entity_count" integer,
	"relationship_count" integer,
	"workspace_path" text,
	"vcs_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_xray_indexed" boolean DEFAULT false NOT NULL,
	"source_template_id" integer,
	"external_ticket_id" text
);
--> statement-breakpoint
CREATE TABLE "mission_retrospectives" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_run_id" integer,
	"success_score" integer,
	"budget_efficiency" numeric(10, 2),
	"time_efficiency" numeric(10, 2),
	"anomalies_encountered" jsonb DEFAULT '[]'::jsonb,
	"learned_context" jsonb DEFAULT '[]'::jsonb,
	"analyzed_by" text,
	"organization_id" integer,
	"mission_id" integer,
	"embedding" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mission_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"mission_id" integer,
	"parent_id" integer,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reasoning_protocol" text DEFAULT 'json_manifest' NOT NULL,
	"current_pipeline_id" integer,
	"pipeline_sequence" jsonb,
	"current_step_index" integer DEFAULT 0,
	"mission_context" jsonb DEFAULT '{}'::jsonb,
	"pipeline_execution_id" integer,
	"last_checkpoint_at" timestamp DEFAULT now(),
	"resume_condition" jsonb,
	"dynamic_trace" jsonb DEFAULT '[]'::jsonb,
	"is_success" boolean,
	"failure_reason" text,
	"actual_metric_value" numeric(10, 2),
	"metric_type" text,
	"context_core_url" text,
	"entity_count" integer,
	"relationship_count" integer,
	"cycle_id" integer,
	"is_shadow" boolean DEFAULT false NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0',
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mission_shadow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_run_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"model_id" text,
	"prompt_version" text,
	"is_success" boolean DEFAULT false,
	"actual_metric_value" numeric(10, 2),
	"metric_type" text,
	"eval_score" integer,
	"eval_reasoning" text,
	"mission_context" jsonb DEFAULT '{}'::jsonb,
	"derived_from_shadow_id" integer,
	"ancestor_shadow_ids" jsonb DEFAULT '[]'::jsonb,
	"cost_usd" numeric(10, 4) DEFAULT '0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mission_step_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_run_id" integer NOT NULL,
	"pipeline_execution_id" integer NOT NULL,
	"pipeline_step_id" integer NOT NULL,
	"organization_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp,
	"completed_at" timestamp,
	"result" jsonb,
	"job_type" text NOT NULL,
	"job_config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mission_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"version" text DEFAULT '1.0.0',
	"star_rating" integer DEFAULT 0,
	"performance_history" jsonb DEFAULT '[]'::jsonb,
	"organization_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "mission_document_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"document_template_id" integer NOT NULL,
	"role" text DEFAULT 'output_standard' NOT NULL,
	"added_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_file_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"file_size" integer,
	"file_data" text,
	"text_content" text,
	"purpose" text DEFAULT 'reference' NOT NULL,
	"added_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_rag_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"rag_asset_id" integer NOT NULL,
	"purpose" text DEFAULT 'reference' NOT NULL,
	"added_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_agent_memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"agent_id" integer,
	"run_id" text,
	"type" text DEFAULT 'observation' NOT NULL,
	"content" text NOT NULL,
	"importance" integer DEFAULT 5,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "agora_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"canvas_state" jsonb DEFAULT '{"objects":[]}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swarm_bids" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"bidding_agent_id" integer NOT NULL,
	"bid_details" jsonb,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swarm_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"requesting_agent_id" integer,
	"description" text NOT NULL,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"winning_bid_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"finding_type" varchar(100) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"recommendation" text,
	"qa_trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"job_id" text,
	"success" boolean NOT NULL,
	"summary" text NOT NULL,
	"output" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"status" varchar(50) DEFAULT 'installed' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"public_slug" text,
	"url" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"title" text,
	"description" text,
	"branding_config" jsonb DEFAULT '{}'::jsonb,
	"access_policy" text DEFAULT 'public',
	"access_password_hash" text,
	"budget_limit_usd" numeric(10, 2),
	"current_spend_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"user_budget_limit" numeric(10, 2),
	"default_model" varchar(100),
	"system_prompt" text,
	"app_memory_enabled" boolean DEFAULT false NOT NULL,
	"webhook_url" text,
	"webhook_type" varchar(20) DEFAULT 'generic' NOT NULL,
	"webhook_secret" text,
	"next_pipeline_id" integer,
	"oddjob_mission_id" integer,
	"hil_enabled" boolean DEFAULT false NOT NULL,
	"ocean_traits" jsonb DEFAULT '{"o": 0.5, "c": 0.5, "e": 0.5, "a": 0.5, "n": 0.5}'::jsonb,
	"soul_archetype" text DEFAULT 'Lead Directive',
	"expertise_job_id" integer,
	"allowed_topic_ids" integer[] DEFAULT ARRAY[]::integer[],
	"allowed_dataset_ids" integer[] DEFAULT ARRAY[]::integer[],
	"allowed_agent_ids" integer[] DEFAULT ARRAY[]::integer[],
	"allowed_pipeline_ids" integer[] DEFAULT ARRAY[]::integer[],
	"default_collections" text[] DEFAULT ARRAY[]::text[],
	"allowed_tools" text[],
	"reasoning_protocol" text DEFAULT 'json_manifest',
	"intelligence_category" text,
	"deployment_mode" text DEFAULT 'chat',
	"browser_start_url" text,
	"browser_goal" text,
	"browser_config" jsonb DEFAULT '{}'::jsonb,
	"navigational_memory_shared" boolean DEFAULT true NOT NULL,
	"min_replicas" integer DEFAULT 1 NOT NULL,
	"max_replicas" integer DEFAULT 3 NOT NULL,
	"target_concurrency" integer DEFAULT 5 NOT NULL,
	"app_token_hash" text,
	"app_token_encrypted" text,
	"app_token_capabilities" text[] DEFAULT ARRAY[]::text[],
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" integer NOT NULL,
	"container_id" text NOT NULL,
	"port" integer NOT NULL,
	"status" varchar(20) DEFAULT 'starting' NOT NULL,
	"last_heartbeat_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"developer_org_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"amount_usd" numeric(10, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"stripe_payout_id" text,
	"mission_run_id" integer,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"collection" varchar(100) NOT NULL,
	"record_id" varchar(100) NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"event" varchar(100) NOT NULL,
	"level" varchar(20) DEFAULT 'info' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"daily_spend_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"monthly_spend_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"last_spend_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"commit_hash" varchar(64) NOT NULL,
	"message" text NOT NULL,
	"author" varchar(255) NOT NULL,
	"branch" varchar(100) DEFAULT 'main' NOT NULL,
	"parent_version_id" text,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"snapshot_path" text NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"lines_added" integer DEFAULT 0 NOT NULL,
	"lines_removed" integer DEFAULT 0 NOT NULL,
	"files_changed" integer DEFAULT 0 NOT NULL,
	"is_rollback" boolean DEFAULT false NOT NULL,
	"rolled_back_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" text,
	"icon" text,
	"manifest_url" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"developer_org_id" integer,
	"organization_id" integer,
	"blueprint" text,
	"blueprint_slug" text,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_by" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" varchar(20) DEFAULT '1.0.0' NOT NULL,
	"changelog" text,
	"v_next_manifest" jsonb,
	"docker_image" text,
	"runtime_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stitch_project_id" text,
	"reference_asset_ids" integer[] DEFAULT ARRAY[]::integer[],
	"development_plan" jsonb,
	"last_approved_plan" jsonb,
	"plan_review_status" varchar(50) DEFAULT 'approved' NOT NULL,
	"oddjob_mission_id" integer,
	"price_per_launch_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"developer_payout_percentage" integer DEFAULT 70 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "apps_name_unique" UNIQUE("name"),
	CONSTRAINT "apps_slug_unique" UNIQUE("slug")
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
CREATE TABLE "health_check_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"check_interval_seconds" integer DEFAULT 30 NOT NULL,
	"check_timeout_seconds" integer DEFAULT 10 NOT NULL,
	"stale_heartbeat_seconds" integer DEFAULT 120 NOT NULL,
	"unhealthy_threshold_count" integer DEFAULT 3 NOT NULL,
	"degraded_threshold_percent" numeric(5, 2) DEFAULT '0.10' NOT NULL,
	"alert_enabled" boolean DEFAULT true NOT NULL,
	"alert_on_unhealthy" boolean DEFAULT true NOT NULL,
	"alert_on_degraded" boolean DEFAULT false NOT NULL,
	"alert_on_stale_heartbeat" boolean DEFAULT true NOT NULL,
	"alert_on_dependency_issue" boolean DEFAULT true NOT NULL,
	"alert_channels" text DEFAULT 'slack' NOT NULL,
	"alert_severity" varchar(20) DEFAULT 'warning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_check_failures" (
	"instance_id" integer PRIMARY KEY NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_time" timestamp with time zone,
	"last_successful_time" timestamp with time zone,
	"alert_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "health_check_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"app_id" integer NOT NULL,
	"check_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"response_time_ms" integer,
	"status" varchar(20) NOT NULL,
	"status_code" integer,
	"database_status" varchar(20),
	"cache_status" varchar(20),
	"broker_status" varchar(20),
	"error_message" text,
	"alert_triggered" boolean DEFAULT false NOT NULL
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
CREATE TABLE "mission_deliverables" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer,
	"mission_run_id" integer,
	"parent_id" integer,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"type" text DEFAULT 'report' NOT NULL,
	"is_critiqued" boolean DEFAULT false NOT NULL,
	"critique_content" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general',
	"icon" text,
	"config" jsonb NOT NULL,
	"parameter_schema" jsonb,
	"is_featured" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "schema_mapping_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"mapping_config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text DEFAULT 'direct' NOT NULL,
	"type" text DEFAULT 'markdown' NOT NULL,
	"content" text,
	"knowledge_document_id" integer,
	"category" text DEFAULT 'general',
	"organization_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "blueprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"version" varchar(20) DEFAULT '1.0.0' NOT NULL,
	"base_path" text,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"category" varchar(50) DEFAULT 'web_app' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blueprints_slug_unique" UNIQUE("slug")
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
CREATE TABLE "cycle_blueprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"cycle_id" integer,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"type" text DEFAULT 'mission' NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb,
	"estimated_days" integer DEFAULT 1,
	"wave_index" integer,
	"on_critical_path" boolean DEFAULT false,
	"config" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"artifact_contracts" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_dependency_gates" (
	"id" serial PRIMARY KEY NOT NULL,
	"cycle_id" integer NOT NULL,
	"upstream_blueprint_name" text NOT NULL,
	"downstream_blueprint_name" text NOT NULL,
	"dependency_type" text DEFAULT 'finish_to_start' NOT NULL,
	"offset_ms" integer DEFAULT 0,
	"offset_direction" text DEFAULT 'plus',
	"status" text DEFAULT 'waiting' NOT NULL,
	"timeout_ms" integer,
	"escalation_state" text DEFAULT 'none',
	"escalated_to" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_strategic_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"cycle_id" integer,
	"alignment_score" integer NOT NULL,
	"analysis" text NOT NULL,
	"suggested_action" text NOT NULL,
	"is_critical_drift" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"objective" text NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"start_date" timestamp DEFAULT now() NOT NULL,
	"end_date" timestamp,
	"recurrence" text DEFAULT 'once',
	"timezone" text DEFAULT 'UTC',
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"priority" integer DEFAULT 5,
	"budget_limit_usd" numeric(12, 2) DEFAULT '100.00',
	"current_spend_usd" numeric(12, 2) DEFAULT '0.00',
	"token_limit" integer DEFAULT 1000000,
	"success_criteria" jsonb DEFAULT '{}'::jsonb,
	"outcome_metrics" jsonb DEFAULT '{}'::jsonb,
	"requires_approval" integer DEFAULT 0,
	"organization_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"blueprint_count" integer DEFAULT 0,
	"execution_plan" jsonb,
	"execution_policy" jsonb DEFAULT '{}'::jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "resource_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"pool_id" integer,
	"cycle_id" integer,
	"resource_id" text NOT NULL,
	"user_id" text,
	"allocated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"auto_release" boolean DEFAULT false,
	"usage" jsonb DEFAULT '{"totalRequests":0,"lastUsed":null,"successRate":0,"avgResponseTime":0,"totalTokens":0}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "resource_pools" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"organization_id" integer,
	"capacity" integer DEFAULT 10,
	"current_utilization" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "collaboration_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycle_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"objective" text NOT NULL,
	"category" text NOT NULL,
	"blueprints" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"organization_id" integer,
	"is_public" boolean DEFAULT false,
	"usage_count" integer DEFAULT 0,
	"rating" integer DEFAULT 0,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"integration_id" integer,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "integration_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"config_schema" jsonb DEFAULT '{}'::jsonb,
	"webhook_endpoints" jsonb DEFAULT '[]'::jsonb,
	"is_public" boolean DEFAULT true,
	"usage_count" integer DEFAULT 0,
	"rating" integer DEFAULT 0,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saas_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"type" text DEFAULT 'webhook' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"organization_id" integer,
	"is_active" boolean DEFAULT true,
	"last_sync" timestamp DEFAULT now(),
	"sync_frequency" integer DEFAULT 60,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
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
CREATE TABLE "capability_doc_file_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"doc_path" text NOT NULL,
	"file_hash" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_sync_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"capability_id" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"capability_version" text DEFAULT '1.0.0' NOT NULL,
	"signature_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"doc_hash" text,
	"last_source" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"signature" jsonb NOT NULL,
	"manifest" jsonb,
	"risk_profile" text DEFAULT 'Low' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_concepts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"source_type" text DEFAULT 'upload' NOT NULL,
	"content_type" text,
	"file_size" integer,
	"file_data" text,
	"url" text,
	"text_content" text,
	"metadata" jsonb,
	"external_id" text,
	"organization_id" integer,
	"mission_id" integer,
	"dataset_item_id" integer,
	"integration_id" integer,
	"workflow_execution_id" integer,
	"workflow_step_id" integer,
	"created_by" text,
	"qdrant_point_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_policy_constraints" (
	"id" serial PRIMARY KEY NOT NULL,
	"concept_id" integer NOT NULL,
	"policy_rule_id" integer NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_smes" (
	"id" serial PRIMARY KEY NOT NULL,
	"concept_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"level" text DEFAULT 'expert' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_topic_concepts" (
	"topic_id" integer NOT NULL,
	"concept_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_topic_concepts_topic_id_concept_id_pk" PRIMARY KEY("topic_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_topic_documents" (
	"topic_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_topic_documents_topic_id_document_id_pk" PRIMARY KEY("topic_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_topic_id" integer,
	"organization_id" integer,
	"mission_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schema_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_documents" integer DEFAULT 0 NOT NULL,
	"processed_documents" integer DEFAULT 0 NOT NULL,
	"successful_documents" integer DEFAULT 0 NOT NULL,
	"failed_documents" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"current_document_id" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"concurrency_limit" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"total_nodes_extracted" integer DEFAULT 0 NOT NULL,
	"total_edges_extracted" integer DEFAULT 0 NOT NULL,
	"error_summary" jsonb DEFAULT '[]'::jsonb,
	"organization_id" integer,
	"mission_id" integer,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "knowledge_document_extractions" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"schema_id" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"progress_message" text,
	"current_step" text,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"nodes_extracted" integer DEFAULT 0 NOT NULL,
	"edges_extracted" integer DEFAULT 0 NOT NULL,
	"error" text,
	"error_details" jsonb,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"bullmq_job_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"organization_id" integer,
	"mission_id" integer,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "graph_schema_defs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"mission_id" integer,
	"name" text NOT NULL,
	"description" text,
	"mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"entity_types" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"relationship_types" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"target_id" integer NOT NULL,
	"relation" text NOT NULL,
	"weight" integer DEFAULT 1,
	"data" jsonb DEFAULT '{}'::jsonb,
	"organization_id" integer,
	"prospect_property_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"mission_id" integer,
	"last_updated_by_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "knowledge_evolution_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"name" text NOT NULL,
	"external_id" text,
	"data" jsonb DEFAULT '{}'::jsonb,
	"knowledge_document_id" integer,
	"knowledge_topic_id" integer,
	"pipeline_execution_id" integer,
	"extraction_sources" jsonb DEFAULT '[]'::jsonb,
	"fingerprint" text,
	"verification_status" text DEFAULT 'staging' NOT NULL,
	"confidence_score" numeric(3, 2),
	"initial_confidence_score" numeric(3, 2),
	"verified_by" text,
	"verified_at" timestamp,
	"last_reaffirmed_at" timestamp,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"utility_score" numeric(5, 2) DEFAULT '1.00',
	"mission_id" integer,
	"organization_id" integer,
	"prospect_property_id" integer,
	"app_id" integer,
	"deployment_id" integer,
	"source_type" text DEFAULT 'system' NOT NULL,
	"fidelity_class" text DEFAULT 'operational' NOT NULL,
	"scope" text DEFAULT 'private' NOT NULL,
	"owner_id" integer,
	"embedding" text,
	"embedding_provider" text,
	"embedding_model" text,
	"embedding_dimensions" integer,
	"embedding_version" text,
	"created_by" text,
	"source_created_at" timestamp,
	"source_updated_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_output_knowledge" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"pipeline_step_execution_id" integer,
	"knowledge_document_id" integer,
	"knowledge_topic_id" integer,
	"output" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"execution_metadata" jsonb,
	"qdrant_point_ids" text[] DEFAULT ARRAY[]::text[],
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_asset" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"asset_type" text NOT NULL,
	"source_type" text NOT NULL,
	"content_type" text,
	"file_size" integer,
	"file_data" text,
	"url" text,
	"text_content" text,
	"qdrant_point_id" text,
	"job_id" integer,
	"organization_id" integer,
	"order" integer DEFAULT 0 NOT NULL,
	"selection_type" text DEFAULT 'custom' NOT NULL,
	"knowledge_topic_id" integer,
	"knowledge_document_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"subject" text,
	"payload" jsonb NOT NULL,
	"organization_id" integer,
	"emitted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_log_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "event_webhook_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"event_type_pattern" text NOT NULL,
	"webhook_url" text NOT NULL,
	"http_method" text DEFAULT 'POST' NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb,
	"payload_template" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"retry_count" integer DEFAULT 3 NOT NULL,
	"retry_delay_ms" integer DEFAULT 5000 NOT NULL,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"last_triggered_at" timestamp,
	"last_success" boolean,
	"last_error" text,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"response_body" text,
	"error" text,
	"request_duration_ms" integer,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "analysis_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context_type" text DEFAULT 'global',
	"context_id" integer,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"job_id" integer,
	"data" jsonb NOT NULL,
	"hash" text NOT NULL,
	"label" text,
	"description" text,
	"is_primary" boolean DEFAULT false,
	"organization_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_execution_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"query_id" integer,
	"query_text" text NOT NULL,
	"execution_time_ms" integer,
	"result_count" integer,
	"status" text NOT NULL,
	"error_message" text,
	"executed_by" text,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'custom',
	"query_structure" jsonb NOT NULL,
	"cypher_template" text,
	"parameters" jsonb DEFAULT '[]'::jsonb,
	"is_public" boolean DEFAULT false,
	"organization_id" integer,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_queries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"query_structure" jsonb NOT NULL,
	"cypher_query" text,
	"organization_id" integer,
	"created_by" text,
	"last_run_at" timestamp,
	"run_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rescue_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"previous_status" text,
	"new_status" text,
	"actor_id" text,
	"actor_type" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_hash" text,
	"previous_event_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rescue_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"mission_id" integer,
	"mission_run_id" integer,
	"public_token" text,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"service_type" text NOT NULL,
	"source" text,
	"failure_context" text,
	"severity" text,
	"user_location" jsonb NOT NULL,
	"secondary_destination" jsonb,
	"provider_id" text,
	"provider_name" text,
	"provider_location" jsonb,
	"arrival_handshake_hash" text,
	"arrival_protocol_verified" boolean DEFAULT false NOT NULL,
	"is_demo_mode" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"recovery_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triage_summary" text,
	"culprit_node_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "rescue_sessions_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "rescue_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"accuracy" numeric(5, 2),
	"heading" numeric(5, 2),
	"speed" numeric(5, 2),
	"client_timestamp" timestamp NOT NULL,
	"server_timestamp" timestamp DEFAULT now() NOT NULL,
	"signature" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "dataset_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"dataset_id" integer NOT NULL,
	"data" jsonb NOT NULL,
	"raw_data" jsonb,
	"pipeline_execution_id" integer,
	"knowledge_node_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" integer,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"schema_mapping" jsonb,
	"validation_rules" jsonb,
	"knowledge_config" jsonb DEFAULT '{}'::jsonb,
	"mission_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ontology_action_log" (
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
CREATE TABLE "app_analytics_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"deployment_id" integer NOT NULL,
	"date" date NOT NULL,
	"launch_count" integer DEFAULT 0 NOT NULL,
	"unique_user_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_command_events" (
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
--> statement-breakpoint
CREATE TABLE "copilot_source_reviews" (
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
--> statement-breakpoint
CREATE TABLE "tool_invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"job_type" text NOT NULL,
	"tool_name" text NOT NULL,
	"organization_id" integer,
	"agent_id" text,
	"mission_id" integer,
	"pipeline_id" integer,
	"user_id" integer,
	"source" text DEFAULT 'agent' NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_type" text,
	"execution_time_ms" integer DEFAULT 0 NOT NULL,
	"input_size" integer DEFAULT 0 NOT NULL,
	"output_size" integer DEFAULT 0 NOT NULL,
	"invoked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fine_tuning_datasets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fine_tuning_examples" (
	"id" serial PRIMARY KEY NOT NULL,
	"dataset_id" integer NOT NULL,
	"input" text NOT NULL,
	"input_context" jsonb,
	"output" text NOT NULL,
	"human_confidence" integer DEFAULT 0,
	"original_ai_confidence" integer,
	"source_job_id" integer,
	"source_pipeline_execution_id" integer,
	"tags" text[] DEFAULT ARRAY[]::text[],
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fine_tuning_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"dataset_id" integer NOT NULL,
	"prompt" text NOT NULL,
	"chosen_response" text NOT NULL,
	"rejected_response" text NOT NULL,
	"human_confidence" integer DEFAULT 0,
	"source_job_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_run_id" integer,
	"routing_decision" text NOT NULL,
	"entropy" real NOT NULL,
	"model_used" text NOT NULL,
	"cost_savings" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intervention_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"intervention_id" text NOT NULL,
	"threshold_id" integer,
	"session_id" text NOT NULL,
	"vector" text NOT NULL,
	"vector_state" jsonb,
	"location" text,
	"agent_decision" text,
	"agent_confidence" real,
	"policies_cited" jsonb,
	"outcome" text,
	"time_to_action_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "intervention_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule" text NOT NULL,
	"vectors" jsonb,
	"weight" real DEFAULT 1 NOT NULL,
	"distillation_round" integer NOT NULL,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intervention_policy_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"suggestion_type" text NOT NULL,
	"rationale" text NOT NULL,
	"proposed_change" jsonb NOT NULL,
	"target_id" integer,
	"target_table" text,
	"distillation_round" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vector" text NOT NULL,
	"operator" text NOT NULL,
	"threshold_value" real NOT NULL,
	"cooldown_ms" integer DEFAULT 60000,
	"enabled" boolean DEFAULT true,
	"triggered_action" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "scoring_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"event_type" text NOT NULL,
	"rule_id" integer,
	"threshold_id" integer,
	"prospect_id" integer,
	"action_type" text NOT NULL,
	"action_config" jsonb,
	"vector_state" jsonb,
	"confidence" real,
	"location" text,
	"mission_run_id" integer,
	"agent_deployment_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_interventions" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"condition_state" text NOT NULL,
	"condition_confidence_threshold" real NOT NULL,
	"effect_type" text NOT NULL,
	"effect_target_selector" text,
	"user_message_template" text,
	"ai_prompt_template" text,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_rule_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"config" jsonb NOT NULL,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "scoring_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rule_type" text DEFAULT 'ui_interaction' NOT NULL,
	"evaluation_config" jsonb,
	"page" text,
	"page_state" text,
	"card" text,
	"element_type" text,
	"element_id" text,
	"activity" text NOT NULL,
	"vector" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"activity_modifier" real DEFAULT 1,
	"sort_order" integer,
	"priority" text DEFAULT 'medium',
	"enabled" boolean DEFAULT true,
	"triggered_action" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	"created_by" integer
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
CREATE TABLE "evaluation_run_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"test_case_id" integer NOT NULL,
	"passed" boolean NOT NULL,
	"agent_response" text,
	"message_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_set_id" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "evaluation_test_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_set_id" integer NOT NULL,
	"input_prompt" text NOT NULL,
	"expected_criteria" text NOT NULL,
	"method" text DEFAULT 'llm_judge' NOT NULL,
	"source_mission_run_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_test_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"job_id" integer,
	"mission_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_critiques" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"segment_id" integer,
	"topic" text,
	"rating" integer NOT NULL,
	"feedback" text,
	"feedback_reason" text,
	"organization_id" integer,
	"created_by" text NOT NULL,
	"message_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "component_effectiveness_aggregates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"component_name" text NOT NULL,
	"component_category" text NOT NULL,
	"total_usages" integer DEFAULT 0,
	"successful_deployments" integer DEFAULT 0,
	"failed_deployments" integer DEFAULT 0,
	"avg_engagement_score" numeric(5, 2),
	"avg_effectiveness_rating" numeric(3, 2),
	"most_common_props" jsonb DEFAULT '{}'::jsonb,
	"best_performing_variant" text,
	"common_pairings" jsonb DEFAULT '[]'::jsonb,
	"usage_trend_7d" numeric(5, 2),
	"usage_trend_30d" numeric(5, 2),
	"last_calculated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "component_usage_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"component_name" text NOT NULL,
	"component_category" text NOT NULL,
	"component_variant" text,
	"app_id" integer,
	"mission_id" integer,
	"pipeline_id" integer,
	"used_in_file" text NOT NULL,
	"deployment_success" boolean DEFAULT false,
	"runtime_errors" integer DEFAULT 0,
	"user_engagement_score" numeric(5, 2),
	"used_with_components" jsonb DEFAULT '[]'::jsonb,
	"props_used" jsonb DEFAULT '{}'::jsonb,
	"complexity_score" numeric(5, 2),
	"effectiveness_rating" numeric(3, 2),
	"suggested_improvements" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_ab_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"prompt_type" text NOT NULL,
	"control_version_id" text NOT NULL,
	"hypothesis" text,
	"traffic_split_percent" numeric(5, 2),
	"min_sample_size" integer DEFAULT 100,
	"status" text DEFAULT 'running' NOT NULL,
	"winner_version_id" text,
	"confidence_level" numeric(5, 2),
	"improvement_percent" numeric(5, 2),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"analysis_notes" text
);
--> statement-breakpoint
CREATE TABLE "prompt_performance_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"prompt_version_id" integer NOT NULL,
	"prompt_type" text NOT NULL,
	"mission_id" integer,
	"app_id" integer,
	"job_id" integer,
	"input_hash" text,
	"output_quality_score" numeric(5, 2),
	"tokens_used" integer,
	"cost_usd" numeric(10, 4),
	"latency_ms" integer,
	"success" boolean NOT NULL,
	"error_type" text,
	"retry_count" integer DEFAULT 0,
	"user_rating" integer,
	"user_feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"prompt_type" text NOT NULL,
	"version_id" text NOT NULL,
	"parent_version_id" text,
	"system_prompt" text NOT NULL,
	"user_prompt_template" text,
	"generation_method" text NOT NULL,
	"mutation_description" text,
	"status" text DEFAULT 'experimental' NOT NULL,
	"usage_count" integer DEFAULT 0,
	"success_rate" numeric(5, 2),
	"avg_tokens_used" numeric(10, 0),
	"avg_cost_usd" numeric(10, 4),
	"user_satisfaction_score" numeric(5, 2),
	"task_completion_rate" numeric(5, 2),
	"error_rate" numeric(5, 2),
	"retry_rate" numeric(5, 2),
	"fitness_score" numeric(5, 2),
	"selection_probability" numeric(5, 4),
	"is_in_ab_test" boolean DEFAULT false,
	"ab_test_group" text,
	"ab_test_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"retired_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "failure_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"cluster_signature" text NOT NULL,
	"signature_algorithm" text DEFAULT 'semantic-embedding',
	"name" text,
	"description" text,
	"severity" text DEFAULT 'medium' NOT NULL,
	"domain" text NOT NULL,
	"incident_count" integer DEFAULT 0,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"frequency_7d" numeric(5, 2),
	"frequency_30d" numeric(5, 2),
	"is_increasing" boolean DEFAULT false,
	"likely_root_cause" text,
	"contributing_factors" jsonb DEFAULT '[]'::jsonb,
	"affected_apps" jsonb DEFAULT '[]'::jsonb,
	"affected_missions" jsonb DEFAULT '[]'::jsonb,
	"total_downtime_ms" integer DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"confidence_score" numeric(5, 2),
	"resolution_strategy" text,
	"prevention_rule_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failure_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"incident_hash" text NOT NULL,
	"cluster_id" integer,
	"severity" text DEFAULT 'medium' NOT NULL,
	"domain" text NOT NULL,
	"subcategory" text,
	"error_message" text,
	"error_stack" text,
	"error_code" text,
	"mission_id" integer,
	"app_id" integer,
	"job_id" integer,
	"component_name" text,
	"file_path" text,
	"triggering_input" jsonb,
	"was_resolved" boolean DEFAULT false,
	"resolution_method" text,
	"resolution_time_ms" integer,
	"prevention_rule_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "prevention_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"rule_type" text NOT NULL,
	"matches_domain" text,
	"matches_cluster_id" integer,
	"matches_pattern" text,
	"matches_component" text,
	"action_config" jsonb NOT NULL,
	"times_triggered" integer DEFAULT 0,
	"times_prevented" integer DEFAULT 0,
	"false_positive_count" integer DEFAULT 0,
	"effectiveness_score" numeric(5, 2),
	"is_active" boolean DEFAULT true,
	"is_auto_generated" boolean DEFAULT true,
	"created_from_cluster_id" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cross_org_insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern_type" text NOT NULL,
	"pattern_name" text NOT NULL,
	"description" text NOT NULL,
	"org_count" integer NOT NULL,
	"total_occurrences" integer NOT NULL,
	"success_rate" numeric(5, 2),
	"applicable_to_org_types" jsonb DEFAULT '[]'::jsonb,
	"applicable_to_use_cases" jsonb DEFAULT '[]'::jsonb,
	"recommendation_strength" numeric(3, 2),
	"recommended_alternative" text,
	"is_verified" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_learning_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"org_type" text,
	"team_size" integer,
	"primary_use_cases" jsonb DEFAULT '[]'::jsonb,
	"preferred_ui_library" text DEFAULT 'domain-ui',
	"preferred_framework" text DEFAULT 'nextjs',
	"preferred_styling" text DEFAULT 'tailwind',
	"preferred_data_fetching" text DEFAULT 'swr',
	"communication_style" text DEFAULT 'balanced',
	"preferred_explanation_depth" text DEFAULT 'moderate',
	"top_performing_components" jsonb DEFAULT '[]'::jsonb,
	"most_used_tools" jsonb DEFAULT '[]'::jsonb,
	"successful_patterns" jsonb DEFAULT '[]'::jsonb,
	"recurring_issues" jsonb DEFAULT '[]'::jsonb,
	"avoided_patterns" jsonb DEFAULT '[]'::jsonb,
	"avg_mission_cost_usd" numeric(10, 4),
	"avg_mission_duration_ms" integer,
	"avg_code_quality_score" numeric(5, 2),
	"learning_enabled" boolean DEFAULT true,
	"auto_apply_learnings" boolean DEFAULT false,
	"allow_cross_org_learning" boolean DEFAULT false,
	"active_experiments" jsonb DEFAULT '[]'::jsonb,
	"custom_system_prompt_additions" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_analyzed_at" timestamp,
	CONSTRAINT "org_learning_profiles_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "org_preference_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"mission_id" integer,
	"app_id" integer,
	"user_id" text,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"value" text,
	"confidence" numeric(3, 2) DEFAULT '0.5',
	"evidence_count" integer DEFAULT 1,
	"evidence_examples" jsonb DEFAULT '[]'::jsonb,
	"is_user_override" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memetic_graph" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"success_count" integer DEFAULT 0,
	"fail_count" integer DEFAULT 0,
	"confidence" double precision DEFAULT 1,
	"context" jsonb,
	"mission_run_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contact_intent_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_fingerprint" text NOT NULL,
	"state_vector" text NOT NULL,
	"confidence" double precision NOT NULL,
	"route_path" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "engagement_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_fingerprint" text NOT NULL,
	"strategy_name" text,
	"prompt_text" text,
	"user_action" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config_schema" jsonb DEFAULT '{}'::jsonb,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quant_branch_influences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"effect" text NOT NULL,
	"amount" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"explanation" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quant_field_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"window_id" uuid,
	"quant_count" integer NOT NULL,
	"field_density" double precision NOT NULL,
	"field_entropy" double precision NOT NULL,
	"field_alignment" double precision NOT NULL,
	"field_divergence" double precision NOT NULL,
	"field_coherence" double precision NOT NULL,
	"collapse_probability" double precision NOT NULL,
	"dominant_status" text NOT NULL,
	"top_attractors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quant_hidden_state_influences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quant_id" uuid NOT NULL,
	"hidden_state_id" uuid NOT NULL,
	"effect" text NOT NULL,
	"amount" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"explanation" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quant_realm_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quant_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"realm" text NOT NULL,
	"plugin_name" text NOT NULL,
	"plugin_version" text NOT NULL,
	"effect" text NOT NULL,
	"amount" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"explanation" text,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quant_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"source_quant_id" uuid NOT NULL,
	"target_quant_id" uuid NOT NULL,
	"relationship_type" text NOT NULL,
	"strength" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"type" text NOT NULL,
	"label" text,
	"status" text NOT NULL,
	"world_knownness" double precision DEFAULT 0 NOT NULL,
	"system_knownness" double precision DEFAULT 0 NOT NULL,
	"evidence_strength" double precision DEFAULT 0 NOT NULL,
	"recognition_level" double precision DEFAULT 0 NOT NULL,
	"resolution_level" double precision DEFAULT 0 NOT NULL,
	"magnitude" double precision DEFAULT 0.5 NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"uncertainty" double precision DEFAULT 1 NOT NULL,
	"entropy_contribution" double precision DEFAULT 0 NOT NULL,
	"source_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_episode_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_prediction_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_quant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lifecycle_status" text DEFAULT 'active' NOT NULL,
	"decay_rate" double precision DEFAULT 0 NOT NULL,
	"ttl_seconds" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_registry" (
	"name" text NOT NULL,
	"version" text NOT NULL,
	"pod" text NOT NULL,
	"sub_pod" text NOT NULL,
	"capability" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"manifest" jsonb NOT NULL,
	"rollout_status" text DEFAULT 'development' NOT NULL,
	"traffic_percent" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_registry_name_version_pk" PRIMARY KEY("name","version")
);
--> statement-breakpoint
CREATE TABLE "plugin_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"context_id" uuid,
	"plugin_name" text NOT NULL,
	"plugin_version" text NOT NULL,
	"pod" text NOT NULL,
	"sub_pod" text NOT NULL,
	"capability" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"confidence" double precision,
	"shadow_mode" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realm_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"branch_id" uuid,
	"quant_id" uuid,
	"score" double precision NOT NULL,
	"agreeing_realms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disagreeing_realms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"neutral_realms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realm_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"conflict_type" text NOT NULL,
	"realms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"severity" text NOT NULL,
	"entropy_delta" double precision NOT NULL,
	"suggested_action" text NOT NULL,
	"explanation" text,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realm_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"quant_id" uuid,
	"event_id" uuid,
	"episode_id" uuid,
	"branch_id" uuid,
	"hidden_state_id" uuid,
	"realm" text NOT NULL,
	"plugin_name" text NOT NULL,
	"plugin_version" text NOT NULL,
	"effect" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"amount" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"uncertainty_delta" double precision DEFAULT 0 NOT NULL,
	"entropy_delta" double precision DEFAULT 0 NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"explanation" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"organization_id" integer,
	"parent_branch_id" uuid,
	"generation" integer DEFAULT 0 NOT NULL,
	"predicate" text NOT NULL,
	"post_predicates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"probability" double precision DEFAULT 0 NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"branch_score" double precision DEFAULT 0 NOT NULL,
	"entropy" double precision DEFAULT 1 NOT NULL,
	"expected_value" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"supporting_quant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interfering_quant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supporting_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opposing_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forward_score" double precision,
	"reverse_score" double precision,
	"bicameral_agreement" double precision,
	"collapse_signal_id" uuid,
	"pruned_reason" text,
	"explanation" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"organization_id" integer,
	"contract" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"organization_id" integer,
	"mode" text NOT NULL,
	"top_predicate" text,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"entropy" double precision DEFAULT 1 NOT NULL,
	"collapse_detected" boolean DEFAULT false NOT NULL,
	"quant_field_summary_id" uuid,
	"hidden_state_estimate_id" uuid,
	"realm_agreement_id" uuid,
	"forward_chamber" jsonb,
	"reverse_chamber" jsonb,
	"bicameral" jsonb,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_performance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"mission_type" text,
	"success" boolean DEFAULT true NOT NULL,
	"yielded_info" boolean DEFAULT false NOT NULL,
	"relevance_score" double precision DEFAULT 0 NOT NULL,
	"organization_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_genealogy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"parent_branch_id" uuid,
	"event_type" text NOT NULL,
	"reason" text,
	"evidence_ids" uuid[] DEFAULT '{}',
	"source_plugin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_score_breakdowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"probability" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"quant_support" double precision NOT NULL,
	"realm_agreement" double precision NOT NULL,
	"hidden_state_alignment" double precision NOT NULL,
	"bicameral_agreement" double precision NOT NULL,
	"expected_value" double precision NOT NULL,
	"consequence_weight" double precision NOT NULL,
	"entropy_penalty" double precision NOT NULL,
	"final_score" double precision NOT NULL,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pruning_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"previous_status" text NOT NULL,
	"new_status" text NOT NULL,
	"decision_type" text NOT NULL,
	"reason" text NOT NULL,
	"confidence" double precision NOT NULL,
	"score_before" double precision NOT NULL,
	"score_after" double precision NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}',
	"plugin_name" text NOT NULL,
	"plugin_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attractor_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"embedding_id" text,
	"description" text,
	"associated_predicates" text[] DEFAULT '{}',
	"associated_hidden_states" text[] DEFAULT '{}',
	"confidence" double precision NOT NULL,
	"pull_strength" double precision NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baseline_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"baseline_type" text NOT NULL,
	"scope" text NOT NULL,
	"value" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"prediction_id" uuid NOT NULL,
	"branch_id" uuid,
	"predicted_predicate" text NOT NULL,
	"actual_outcome" text NOT NULL,
	"matched" boolean NOT NULL,
	"confidence_at_prediction" double precision NOT NULL,
	"entropy_at_prediction" double precision NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_recall_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"memory_types" text[] NOT NULL,
	"mode" text NOT NULL,
	"result_count" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"pattern_type" text NOT NULL,
	"signature" text,
	"embedding_id" text,
	"typical_predicates" text[] DEFAULT '{}',
	"typical_post_predicates" text[] DEFAULT '{}',
	"confidence" double precision NOT NULL,
	"support_count" integer DEFAULT 0 NOT NULL,
	"false_positive_rate" double precision,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid,
	"previous_snapshot_id" uuid,
	"current_snapshot_id" uuid,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"type" text NOT NULL,
	"strength" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"weight" double precision NOT NULL,
	"direction" text DEFAULT 'directed' NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}',
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid,
	"type" text NOT NULL,
	"label" text,
	"ref_id" uuid NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid,
	"snapshot_type" text NOT NULL,
	"node_count" integer NOT NULL,
	"edge_count" integer NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hidden_state_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"confidence" double precision NOT NULL,
	"probability" double precision NOT NULL,
	"activation" double precision NOT NULL,
	"persistence" double precision NOT NULL,
	"entropy" double precision NOT NULL,
	"supporting_quant_ids" uuid[] DEFAULT '{}',
	"opposing_quant_ids" uuid[] DEFAULT '{}',
	"supporting_event_ids" uuid[] DEFAULT '{}',
	"opposing_event_ids" uuid[] DEFAULT '{}',
	"realm_contribution_ids" uuid[] DEFAULT '{}',
	"memory_ids" uuid[] DEFAULT '{}',
	"attractor_ids" uuid[] DEFAULT '{}',
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hidden_state_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"window_id" uuid,
	"top_candidate_id" uuid,
	"top_label" text,
	"confidence" double precision NOT NULL,
	"entropy" double precision NOT NULL,
	"split_detected" boolean DEFAULT false NOT NULL,
	"collapse_detected" boolean DEFAULT false NOT NULL,
	"dominant_attractor_id" uuid,
	"field_summary_id" uuid,
	"realm_agreement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hidden_state_influences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hidden_state_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"effect" text NOT NULL,
	"amount" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"explanation" text,
	"evidence_ids" uuid[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hidden_state_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"candidate_state_ids" uuid[] NOT NULL,
	"tension_score" double precision NOT NULL,
	"entropy_delta" double precision NOT NULL,
	"possible_explanations" text[] DEFAULT '{}',
	"evidence_ids" uuid[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hidden_state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"from_state_id" uuid,
	"to_state_id" uuid NOT NULL,
	"transition_type" text NOT NULL,
	"probability" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}',
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diff_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"type" text NOT NULL,
	"realm" text,
	"source_ref_id" uuid,
	"target_ref_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"magnitude" double precision NOT NULL,
	"velocity" double precision,
	"acceleration" double precision,
	"entropy_delta" double precision,
	"significance" double precision NOT NULL,
	"direction" text,
	"drift_detected" boolean DEFAULT false NOT NULL,
	"anomaly_detected" boolean DEFAULT false NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}',
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diff_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"snapshot_type" text NOT NULL,
	"snapshot_ref_id" uuid,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diff_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"trigger_type" text NOT NULL,
	"significance" double precision NOT NULL,
	"reason" text,
	"evidence_ids" uuid[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drift_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"drift_type" text NOT NULL,
	"direction" text,
	"magnitude" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}',
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expected_event_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"expected_gap_ms" bigint NOT NULL,
	"tolerance_ms" bigint NOT NULL,
	"confidence" double precision NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"event_id" uuid,
	"quant_id" uuid,
	"observed_at" timestamp with time zone NOT NULL,
	"duration_ms" bigint,
	"window_ids" uuid[] DEFAULT '{}',
	"sequence_index" bigint,
	"prior_event_id" uuid,
	"pre_prior_event_ids" uuid[] DEFAULT '{}',
	"recency" double precision NOT NULL,
	"frequency" double precision NOT NULL,
	"persistence" double precision NOT NULL,
	"burst_score" double precision NOT NULL,
	"silence_score" double precision NOT NULL,
	"expected_gap_ms" bigint,
	"actual_gap_ms" bigint,
	"gap_ratio" double precision,
	"density_mode" text NOT NULL,
	"temporal_validity" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"source_ref_id" uuid NOT NULL,
	"target_ref_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"target_type" text NOT NULL,
	"relation" text NOT NULL,
	"confidence" double precision NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "window_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"type" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"duration_ms" bigint NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"quant_count" integer,
	"episode_count" integer,
	"event_density" double precision DEFAULT 0 NOT NULL,
	"quant_density" double precision,
	"density_mode" text DEFAULT 'normal' NOT NULL,
	"top_actions" text[] DEFAULT '{}',
	"top_concepts" text[] DEFAULT '{}',
	"top_themes" text[] DEFAULT '{}',
	"entropy" double precision,
	"burst_score" double precision,
	"silence_score" double precision,
	"persistence_score" double precision,
	"region_id" uuid,
	"area_m2" double precision,
	"geo_density" double precision,
	"spacetime_density" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canonical_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_version" text DEFAULT '1.0' NOT NULL,
	"context_id" uuid NOT NULL,
	"tenant_id" text,
	"actor_id" text,
	"object_id" text,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"event_kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_at" timestamp with time zone,
	"duration_ms" bigint,
	"confidence" double precision NOT NULL,
	"source_trust" double precision NOT NULL,
	"raw_payload_ref" text,
	"raw_payload" jsonb,
	"canonical_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"classification" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sensitivity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lineage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"repair" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_event_id" uuid NOT NULL,
	"correction_event_id" uuid NOT NULL,
	"correction_type" text NOT NULL,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_deduplication_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"key_type" text NOT NULL,
	"key_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_deduplication_keys_key_type_key_value_unique" UNIQUE("key_type","key_value")
);
--> statement-breakpoint
CREATE TABLE "event_rejections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text,
	"source_event_id" text,
	"reason" text NOT NULL,
	"code" text NOT NULL,
	"recoverable" boolean DEFAULT false NOT NULL,
	"raw_payload" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_context_id" uuid NOT NULL,
	"target_context_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"confidence" double precision NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_resolution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"resolved_context_id" uuid,
	"input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"created_new" boolean DEFAULT false NOT NULL,
	"warnings" text[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"label" text,
	"tenant_id" text,
	"application_id" text,
	"actor_id" text,
	"workflow_id" text,
	"session_id" text,
	"task_id" text,
	"agent_id" text,
	"region_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"confidence" double precision DEFAULT 0.8 NOT NULL,
	"resolution_method" text DEFAULT 'created' NOT NULL,
	"evidence_event_ids" uuid[] DEFAULT '{}',
	"evidence_quant_ids" uuid[] DEFAULT '{}',
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"baseline_refs" text[] DEFAULT '{}',
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid,
	"context_id" uuid NOT NULL,
	"subject_id" text,
	"action_type" text,
	"resource_type" text,
	"decision" text NOT NULL,
	"policy_version" text NOT NULL,
	"audit_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"subject_id" text,
	"decision" text NOT NULL,
	"allowed" boolean NOT NULL,
	"max_action_level" text NOT NULL,
	"risk_class" text NOT NULL,
	"requires_human_confirmation" boolean DEFAULT false NOT NULL,
	"requires_explanation" boolean DEFAULT false NOT NULL,
	"requires_audit" boolean DEFAULT true NOT NULL,
	"confidence_threshold" double precision,
	"confidence_adjustment" double precision,
	"redactions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}',
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"policy_type" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "governance_policies_name_version_unique" UNIQUE("name","version")
);
--> statement-breakpoint
CREATE TABLE "governance_simulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid,
	"policy_version" text NOT NULL,
	"input_payload" jsonb NOT NULL,
	"result_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"prediction_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"outcome_match_id" uuid NOT NULL,
	"top_prediction_correct" boolean NOT NULL,
	"true_branch_present" boolean NOT NULL,
	"true_branch_status" text,
	"confidence_at_prediction" double precision NOT NULL,
	"entropy_at_prediction" double precision NOT NULL,
	"calibrated_confidence" double precision,
	"prediction_error" double precision NOT NULL,
	"calibration_error" double precision NOT NULL,
	"brier_score" double precision,
	"log_loss" double precision,
	"false_positive" boolean DEFAULT false NOT NULL,
	"false_negative" boolean DEFAULT false NOT NULL,
	"false_prune" boolean DEFAULT false NOT NULL,
	"lucky_correct" boolean DEFAULT false NOT NULL,
	"overconfident" boolean DEFAULT false NOT NULL,
	"underconfident" boolean DEFAULT false NOT NULL,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"target_name" text,
	"signal_type" text NOT NULL,
	"amount" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"reason" text NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}',
	"applied" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observed_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"outcome_type" text NOT NULL,
	"label" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"source_trust" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"related_event_ids" uuid[] DEFAULT '{}',
	"related_quant_ids" uuid[] DEFAULT '{}',
	"related_prediction_ids" uuid[] DEFAULT '{}',
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcome_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"context_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"prediction_id" uuid NOT NULL,
	"matched_branch_id" uuid,
	"matched_predicate" text,
	"match_type" text NOT NULL,
	"match_score" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"explanation" text,
	"evidence_ids" uuid[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_reliability_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_name" text NOT NULL,
	"plugin_version" text NOT NULL,
	"context_scope" text,
	"reliability_score" double precision NOT NULL,
	"accuracy_contribution" double precision,
	"false_positive_contribution" double precision,
	"false_negative_contribution" double precision,
	"false_prune_contribution" double precision,
	"sample_size" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realm_reliability_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"realm" text NOT NULL,
	"context_scope" text,
	"reliability_score" double precision NOT NULL,
	"overboost_rate" double precision,
	"underboost_rate" double precision,
	"sample_size" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explanation_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"explanation_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"governance_version" text,
	"redactions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plugins_used" text[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "explanation_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"explanation_id" uuid NOT NULL,
	"evidence_type" text NOT NULL,
	"contribution" double precision NOT NULL,
	"confidence" double precision NOT NULL,
	"polarity" text NOT NULL,
	"explanation" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_explanations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"explanation_type" text NOT NULL,
	"audience" text NOT NULL,
	"summary" text NOT NULL,
	"explanation_score" double precision DEFAULT 0.8 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_roles" ADD CONSTRAINT "admin_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_roles" ADD CONSTRAINT "admin_roles_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_suppression_policy_id_suppression_policies_policy_id_fk" FOREIGN KEY ("suppression_policy_id") REFERENCES "public"."suppression_policies"("policy_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_orgs" ADD CONSTRAINT "user_orgs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_orgs" ADD CONSTRAINT "user_orgs_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_logs" ADD CONSTRAINT "integration_logs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_file_versions" ADD CONSTRAINT "stored_file_versions_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_dependencies" ADD CONSTRAINT "system_dependencies_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_request_logs" ADD CONSTRAINT "gateway_request_logs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_spec_access" ADD CONSTRAINT "org_spec_access_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_spec_access" ADD CONSTRAINT "org_spec_access_spec_id_api_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."api_specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saas_connectors" ADD CONSTRAINT "saas_connectors_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saas_event_workflows" ADD CONSTRAINT "saas_event_workflows_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saas_schema_snapshots" ADD CONSTRAINT "saas_schema_snapshots_connector_id_saas_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."saas_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saas_sync_configs" ADD CONSTRAINT "saas_sync_configs_connector_id_saas_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."saas_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_channel_subscriptions" ADD CONSTRAINT "slack_channel_subscriptions_workspace_id_slack_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."slack_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_channel_subscriptions" ADD CONSTRAINT "slack_channel_subscriptions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_commands" ADD CONSTRAINT "slack_commands_workspace_id_slack_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."slack_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_commands" ADD CONSTRAINT "slack_commands_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_interactions" ADD CONSTRAINT "slack_interactions_workspace_id_slack_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."slack_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_interactions" ADD CONSTRAINT "slack_interactions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_notifications" ADD CONSTRAINT "slack_notifications_workspace_id_slack_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."slack_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_notifications" ADD CONSTRAINT "slack_notifications_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_contexts" ADD CONSTRAINT "slack_user_contexts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_workspaces" ADD CONSTRAINT "slack_workspaces_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory" ADD CONSTRAINT "user_memory_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trycua_computer_use_task_steps" ADD CONSTRAINT "trycua_computer_use_task_steps_task_id_trycua_computer_use_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."trycua_computer_use_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trycua_computer_use_task_steps" ADD CONSTRAINT "trycua_computer_use_task_steps_session_id_trycua_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."trycua_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trycua_computer_use_task_steps" ADD CONSTRAINT "trycua_computer_use_task_steps_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trycua_computer_use_tasks" ADD CONSTRAINT "trycua_computer_use_tasks_session_id_trycua_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."trycua_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trycua_computer_use_tasks" ADD CONSTRAINT "trycua_computer_use_tasks_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trycua_session_events" ADD CONSTRAINT "trycua_session_events_session_id_trycua_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."trycua_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trycua_session_events" ADD CONSTRAINT "trycua_session_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trycua_sessions" ADD CONSTRAINT "trycua_sessions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_models" ADD CONSTRAINT "llm_models_provider_id_llm_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."llm_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_provider_health" ADD CONSTRAINT "llm_provider_health_provider_id_llm_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."llm_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_router_logs" ADD CONSTRAINT "llm_router_logs_selected_provider_id_llm_providers_id_fk" FOREIGN KEY ("selected_provider_id") REFERENCES "public"."llm_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_router_logs" ADD CONSTRAINT "llm_router_logs_selected_model_id_llm_models_id_fk" FOREIGN KEY ("selected_model_id") REFERENCES "public"."llm_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_router_logs" ADD CONSTRAINT "llm_router_logs_routing_rule_id_llm_routing_rules_id_fk" FOREIGN KEY ("routing_rule_id") REFERENCES "public"."llm_routing_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_routing_rules" ADD CONSTRAINT "llm_routing_rules_target_model_id_llm_models_id_fk" FOREIGN KEY ("target_model_id") REFERENCES "public"."llm_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_spend_history" ADD CONSTRAINT "monthly_spend_history_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_versions" ADD CONSTRAINT "entity_versions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_locks" ADD CONSTRAINT "run_locks_scheduled_job_id_scheduled_jobs_scheduled_job_id_fk" FOREIGN KEY ("scheduled_job_id") REFERENCES "public"."scheduled_jobs"("scheduled_job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_execution_history" ADD CONSTRAINT "schedule_execution_history_scheduled_job_id_scheduled_jobs_scheduled_job_id_fk" FOREIGN KEY ("scheduled_job_id") REFERENCES "public"."scheduled_jobs"("scheduled_job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_execution_history" ADD CONSTRAINT "schedule_execution_history_trigger_id_schedule_triggers_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."schedule_triggers"("trigger_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_execution_history" ADD CONSTRAINT "schedule_execution_history_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_triggers" ADD CONSTRAINT "schedule_triggers_scheduled_job_id_scheduled_jobs_scheduled_job_id_fk" FOREIGN KEY ("scheduled_job_id") REFERENCES "public"."scheduled_jobs"("scheduled_job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_schedule_id_schedules_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("schedule_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_agent_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_triggers" ADD CONSTRAINT "heartbeat_triggers_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_triggers" ADD CONSTRAINT "heartbeat_triggers_agent_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alert_configs" ADD CONSTRAINT "error_alert_configs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_alerts" ADD CONSTRAINT "error_alerts_config_id_error_alert_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."error_alert_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_clusters" ADD CONSTRAINT "error_clusters_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_diagnoses" ADD CONSTRAINT "error_diagnoses_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_embeddings" ADD CONSTRAINT "error_embeddings_error_diagnosis_id_error_diagnoses_diagnosis_id_fk" FOREIGN KEY ("error_diagnosis_id") REFERENCES "public"."error_diagnoses"("diagnosis_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_embeddings" ADD CONSTRAINT "error_embeddings_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forensic_event_log" ADD CONSTRAINT "forensic_event_log_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forensic_event_log" ADD CONSTRAINT "forensic_event_log_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reasoning_audits" ADD CONSTRAINT "reasoning_audits_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_scheduled_job_id_scheduled_jobs_scheduled_job_id_fk" FOREIGN KEY ("scheduled_job_id") REFERENCES "public"."scheduled_jobs"("scheduled_job_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_metrics" ADD CONSTRAINT "performance_metrics_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_logs" ADD CONSTRAINT "rate_limit_logs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ADD CONSTRAINT "pipeline_versions_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ADD CONSTRAINT "pipeline_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_governor_policy_id_governor_policies_id_fk" FOREIGN KEY ("governor_policy_id") REFERENCES "public"."governor_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_fallback_job_id_jobs_id_fk" FOREIGN KEY ("fallback_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."pipeline_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_step_execution_id_pipeline_step_executions_id_fk" FOREIGN KEY ("step_execution_id") REFERENCES "public"."pipeline_step_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD CONSTRAINT "pipeline_executions_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD CONSTRAINT "pipeline_executions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD CONSTRAINT "pipeline_executions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_executions" ADD CONSTRAINT "pipeline_executions_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_step_executions" ADD CONSTRAINT "pipeline_step_executions_pipeline_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("pipeline_execution_id") REFERENCES "public"."pipeline_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_step_executions" ADD CONSTRAINT "pipeline_step_executions_pipeline_step_id_pipeline_steps_id_fk" FOREIGN KEY ("pipeline_step_id") REFERENCES "public"."pipeline_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_step_executions" ADD CONSTRAINT "pipeline_step_executions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_triggers" ADD CONSTRAINT "pipeline_triggers_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_trigger_logs" ADD CONSTRAINT "pipeline_trigger_logs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_trigger_logs" ADD CONSTRAINT "pipeline_trigger_logs_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_trigger_logs" ADD CONSTRAINT "pipeline_trigger_logs_trigger_id_pipeline_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."pipeline_triggers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_trigger_logs" ADD CONSTRAINT "pipeline_trigger_logs_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."pipeline_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_scores" ADD CONSTRAINT "drift_scores_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_scores" ADD CONSTRAINT "drift_scores_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_scores" ADD CONSTRAINT "drift_scores_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."pipeline_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_run_events" ADD CONSTRAINT "cycle_run_events_run_id_operational_cycles_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."operational_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_run_events" ADD CONSTRAINT "cycle_run_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_dependencies" ADD CONSTRAINT "job_dependencies_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_dependencies" ADD CONSTRAINT "job_dependencies_depends_on_job_id_jobs_id_fk" FOREIGN KEY ("depends_on_job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_dependencies" ADD CONSTRAINT "job_dependencies_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_output_knowledge_topic_id_knowledge_topics_id_fk" FOREIGN KEY ("output_knowledge_topic_id") REFERENCES "public"."knowledge_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_output_dataset_id_datasets_id_fk" FOREIGN KEY ("output_dataset_id") REFERENCES "public"."datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_governor_policy_id_governor_policies_id_fk" FOREIGN KEY ("governor_policy_id") REFERENCES "public"."governor_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_contexts" ADD CONSTRAINT "agent_chat_contexts_agent_id_jobs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_contexts" ADD CONSTRAINT "agent_chat_contexts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_thread_id_agent_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_messages" ADD CONSTRAINT "agent_chat_messages_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_threads" ADD CONSTRAINT "agent_chat_threads_agent_id_jobs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_chat_threads" ADD CONSTRAINT "agent_chat_threads_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_response_templates" ADD CONSTRAINT "agent_response_templates_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_response_templates" ADD CONSTRAINT "agent_response_templates_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_hints" ADD CONSTRAINT "agent_tool_hints_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_hints" ADD CONSTRAINT "agent_tool_hints_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_suggestions" ADD CONSTRAINT "optimization_suggestions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_test" ADD CONSTRAINT "reference_test_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_logs" ADD CONSTRAINT "transaction_logs_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."pipeline_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_suggestions" ADD CONSTRAINT "mission_suggestions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_suggestions" ADD CONSTRAINT "mission_suggestions_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pips" ADD CONSTRAINT "agent_pips_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_long_term_memories" ADD CONSTRAINT "agent_long_term_memories_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_long_term_memories" ADD CONSTRAINT "agent_long_term_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_platform_identities" ADD CONSTRAINT "user_platform_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_platform_identities" ADD CONSTRAINT "user_platform_identities_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_representations" ADD CONSTRAINT "user_representations_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_representations" ADD CONSTRAINT "user_representations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_graph_entries" ADD CONSTRAINT "agent_knowledge_graph_entries_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_questions" ADD CONSTRAINT "knowledge_base_questions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection_logs" ADD CONSTRAINT "reflection_logs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection_patterns" ADD CONSTRAINT "reflection_patterns_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection_stats_daily" ADD CONSTRAINT "reflection_stats_daily_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deployments" ADD CONSTRAINT "agent_deployments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deployments" ADD CONSTRAINT "agent_deployments_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_input_params" ADD CONSTRAINT "pipeline_input_params_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_output_params" ADD CONSTRAINT "pipeline_output_params_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_collection_items" ADD CONSTRAINT "job_collection_items_collection_id_job_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."job_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_collection_items" ADD CONSTRAINT "job_collection_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_collections" ADD CONSTRAINT "job_collections_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_collection_executions" ADD CONSTRAINT "mission_collection_executions_collection_id_job_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."job_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_collection_executions" ADD CONSTRAINT "mission_collection_executions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version_history" ADD CONSTRAINT "skill_version_history_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlink_clicks" ADD CONSTRAINT "shortlink_clicks_shortlink_id_shortlinks_id_fk" FOREIGN KEY ("shortlink_id") REFERENCES "public"."shortlinks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlinks" ADD CONSTRAINT "shortlinks_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_salaries" ADD CONSTRAINT "agent_salaries_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governor_policies" ADD CONSTRAINT "governor_policies_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governor_policy_rules" ADD CONSTRAINT "governor_policy_rules_policy_id_governor_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."governor_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_spend_events" ADD CONSTRAINT "agent_spend_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_agent_salaries" ADD CONSTRAINT "governance_agent_salaries_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_approvals" ADD CONSTRAINT "governance_approvals_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_budget_policies" ADD CONSTRAINT "governance_budget_policies_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credential_leases" ADD CONSTRAINT "agent_credential_leases_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credential_leases" ADD CONSTRAINT "agent_credential_leases_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_governance_audit_events" ADD CONSTRAINT "agent_governance_audit_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_governance_audit_events" ADD CONSTRAINT "agent_governance_audit_events_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_permission_grants" ADD CONSTRAINT "agent_permission_grants_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_permission_grants" ADD CONSTRAINT "agent_permission_grants_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_policy_bundles" ADD CONSTRAINT "agent_policy_bundles_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_violations" ADD CONSTRAINT "policy_violations_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_performances" ADD CONSTRAINT "agent_performances_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_upskilling_jobs" ADD CONSTRAINT "agent_upskilling_jobs_pip_id_performance_improvement_plans_id_fk" FOREIGN KEY ("pip_id") REFERENCES "public"."performance_improvement_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_improvement_plans" ADD CONSTRAINT "performance_improvement_plans_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_knowledge_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("knowledge_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hil_forms" ADD CONSTRAINT "hil_forms_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hil_forms" ADD CONSTRAINT "hil_forms_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hil_forms" ADD CONSTRAINT "hil_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_api_tokens" ADD CONSTRAINT "mcp_api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_api_tokens" ADD CONSTRAINT "mcp_api_tokens_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_events" ADD CONSTRAINT "prospect_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_events" ADD CONSTRAINT "prospect_events_property_id_prospect_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."prospect_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_events" ADD CONSTRAINT "prospect_events_profile_id_prospect_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."prospect_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_leads" ADD CONSTRAINT "prospect_leads_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_leads" ADD CONSTRAINT "prospect_leads_profile_id_prospect_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."prospect_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_profiles" ADD CONSTRAINT "prospect_profiles_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_profiles" ADD CONSTRAINT "prospect_profiles_property_id_prospect_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."prospect_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_properties" ADD CONSTRAINT "prospect_properties_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "antigravity_incidents" ADD CONSTRAINT "antigravity_incidents_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_blackboard_history" ADD CONSTRAINT "mission_blackboard_history_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_members" ADD CONSTRAINT "mission_members_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_parent_id_missions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_governor_policy_id_governor_policies_id_fk" FOREIGN KEY ("governor_policy_id") REFERENCES "public"."governor_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_schedule_id_schedules_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("schedule_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_retrospectives" ADD CONSTRAINT "mission_retrospectives_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_retrospectives" ADD CONSTRAINT "mission_retrospectives_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_retrospectives" ADD CONSTRAINT "mission_retrospectives_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD CONSTRAINT "mission_runs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD CONSTRAINT "mission_runs_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD CONSTRAINT "mission_runs_parent_id_mission_runs_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD CONSTRAINT "mission_runs_current_pipeline_id_pipelines_id_fk" FOREIGN KEY ("current_pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD CONSTRAINT "mission_runs_cycle_id_operational_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."operational_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_shadow_runs" ADD CONSTRAINT "mission_shadow_runs_parent_run_id_mission_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_shadow_runs" ADD CONSTRAINT "mission_shadow_runs_derived_from_shadow_id_mission_shadow_runs_id_fk" FOREIGN KEY ("derived_from_shadow_id") REFERENCES "public"."mission_shadow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_step_assignments" ADD CONSTRAINT "mission_step_assignments_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_step_assignments" ADD CONSTRAINT "mission_step_assignments_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_templates" ADD CONSTRAINT "mission_templates_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_proposals" ADD CONSTRAINT "template_proposals_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_proposals" ADD CONSTRAINT "template_proposals_source_template_id_mission_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."mission_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_proposals" ADD CONSTRAINT "template_proposals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_app_bindings" ADD CONSTRAINT "mission_app_bindings_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_app_bindings" ADD CONSTRAINT "mission_app_bindings_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_document_templates" ADD CONSTRAINT "mission_document_templates_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_file_attachments" ADD CONSTRAINT "mission_file_attachments_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_rag_assets" ADD CONSTRAINT "mission_rag_assets_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_agent_memories" ADD CONSTRAINT "mission_agent_memories_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_agent_memories" ADD CONSTRAINT "mission_agent_memories_agent_id_jobs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_agent_assignments" ADD CONSTRAINT "mission_agent_assignments_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_agent_assignments" ADD CONSTRAINT "mission_agent_assignments_agent_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agora_sessions" ADD CONSTRAINT "agora_sessions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swarm_bids" ADD CONSTRAINT "swarm_bids_task_id_swarm_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."swarm_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swarm_bids" ADD CONSTRAINT "swarm_bids_bidding_agent_id_app_deployments_id_fk" FOREIGN KEY ("bidding_agent_id") REFERENCES "public"."app_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swarm_tasks" ADD CONSTRAINT "swarm_tasks_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swarm_tasks" ADD CONSTRAINT "swarm_tasks_requesting_agent_id_app_deployments_id_fk" FOREIGN KEY ("requesting_agent_id") REFERENCES "public"."app_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_audit_logs" ADD CONSTRAINT "app_audit_logs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_audit_logs" ADD CONSTRAINT "app_audit_logs_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_audits" ADD CONSTRAINT "app_audits_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_deployments" ADD CONSTRAINT "app_deployments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_deployments" ADD CONSTRAINT "app_deployments_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_deployments" ADD CONSTRAINT "app_deployments_next_pipeline_id_pipelines_id_fk" FOREIGN KEY ("next_pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_deployments" ADD CONSTRAINT "app_deployments_oddjob_mission_id_missions_id_fk" FOREIGN KEY ("oddjob_mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_deployments" ADD CONSTRAINT "app_deployments_expertise_job_id_jobs_id_fk" FOREIGN KEY ("expertise_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_instances" ADD CONSTRAINT "app_instances_deployment_id_app_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."app_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_payouts" ADD CONSTRAINT "app_payouts_developer_org_id_orgs_org_id_fk" FOREIGN KEY ("developer_org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_payouts" ADD CONSTRAINT "app_payouts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_records" ADD CONSTRAINT "app_records_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_records" ADD CONSTRAINT "app_records_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_telemetry" ADD CONSTRAINT "app_telemetry_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_telemetry" ADD CONSTRAINT "app_telemetry_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_usage" ADD CONSTRAINT "app_user_usage_deployment_id_app_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."app_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_usage" ADD CONSTRAINT "app_user_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_versions" ADD CONSTRAINT "app_versions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_versions" ADD CONSTRAINT "app_versions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_versions" ADD CONSTRAINT "app_versions_parent_version_id_app_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."app_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_developer_org_id_orgs_org_id_fk" FOREIGN KEY ("developer_org_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_oddjob_mission_id_missions_id_fk" FOREIGN KEY ("oddjob_mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consistency_remediation_config" ADD CONSTRAINT "consistency_remediation_config_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_config" ADD CONSTRAINT "health_check_config_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_failures" ADD CONSTRAINT "health_check_failures_instance_id_app_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."app_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_instance_id_app_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."app_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "mission_deliverables" ADD CONSTRAINT "mission_deliverables_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_deliverables" ADD CONSTRAINT "mission_deliverables_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_deliverables" ADD CONSTRAINT "mission_deliverables_parent_id_mission_deliverables_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."mission_deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_templates" ADD CONSTRAINT "blueprint_templates_blueprint_id_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_templates" ADD CONSTRAINT "blueprint_templates_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_executions" ADD CONSTRAINT "template_executions_blueprint_template_id_blueprint_templates_id_fk" FOREIGN KEY ("blueprint_template_id") REFERENCES "public"."blueprint_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_executions" ADD CONSTRAINT "template_executions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_blueprints" ADD CONSTRAINT "cycle_blueprints_cycle_id_operational_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."operational_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_dependency_gates" ADD CONSTRAINT "cycle_dependency_gates_cycle_id_operational_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."operational_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_strategic_audits" ADD CONSTRAINT "cycle_strategic_audits_cycle_id_operational_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."operational_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_webhooks" ADD CONSTRAINT "cycle_webhooks_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_cycles" ADD CONSTRAINT "operational_cycles_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_pool_id_resource_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."resource_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_cycle_id_operational_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."operational_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_pools" ADD CONSTRAINT "resource_pools_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_edges" ADD CONSTRAINT "resource_edges_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaboration_events" ADD CONSTRAINT "collaboration_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_templates" ADD CONSTRAINT "cycle_templates_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_permissions" ADD CONSTRAINT "team_permissions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_integration_id_saas_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."saas_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saas_integrations" ADD CONSTRAINT "saas_integrations_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_cycle_id_operational_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."operational_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_registry" ADD CONSTRAINT "artifact_registry_session_id_generation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."generation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_registry" ADD CONSTRAINT "artifact_registry_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_registry" ADD CONSTRAINT "artifact_registry_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_doc_file_state" ADD CONSTRAINT "capability_doc_file_state_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_sync_state" ADD CONSTRAINT "capability_sync_state_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_concepts" ADD CONSTRAINT "knowledge_concepts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_integration_id_saas_connectors_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."saas_connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_policy_constraints" ADD CONSTRAINT "knowledge_policy_constraints_concept_id_knowledge_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."knowledge_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_policy_constraints" ADD CONSTRAINT "knowledge_policy_constraints_policy_rule_id_governor_policy_rules_id_fk" FOREIGN KEY ("policy_rule_id") REFERENCES "public"."governor_policy_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_smes" ADD CONSTRAINT "knowledge_smes_concept_id_knowledge_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."knowledge_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_topic_concepts" ADD CONSTRAINT "knowledge_topic_concepts_topic_id_knowledge_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."knowledge_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_topic_concepts" ADD CONSTRAINT "knowledge_topic_concepts_concept_id_knowledge_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."knowledge_concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_topic_documents" ADD CONSTRAINT "knowledge_topic_documents_topic_id_knowledge_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."knowledge_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_topic_documents" ADD CONSTRAINT "knowledge_topic_documents_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_topics" ADD CONSTRAINT "knowledge_topics_parent_topic_id_knowledge_topics_id_fk" FOREIGN KEY ("parent_topic_id") REFERENCES "public"."knowledge_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_topics" ADD CONSTRAINT "knowledge_topics_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_topics" ADD CONSTRAINT "knowledge_topics_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_batches" ADD CONSTRAINT "extraction_batches_schema_id_graph_schema_defs_id_fk" FOREIGN KEY ("schema_id") REFERENCES "public"."graph_schema_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_batches" ADD CONSTRAINT "extraction_batches_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_batches" ADD CONSTRAINT "extraction_batches_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_extractions" ADD CONSTRAINT "knowledge_document_extractions_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_extractions" ADD CONSTRAINT "knowledge_document_extractions_schema_id_graph_schema_defs_id_fk" FOREIGN KEY ("schema_id") REFERENCES "public"."graph_schema_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_document_extractions" ADD CONSTRAINT "knowledge_document_extractions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_schema_defs" ADD CONSTRAINT "graph_schema_defs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_schema_defs" ADD CONSTRAINT "graph_schema_defs_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_id_knowledge_nodes_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_target_id_knowledge_nodes_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_prospect_property_id_prospect_properties_id_fk" FOREIGN KEY ("prospect_property_id") REFERENCES "public"."prospect_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_last_updated_by_run_id_pipeline_executions_id_fk" FOREIGN KEY ("last_updated_by_run_id") REFERENCES "public"."pipeline_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_evolution_events" ADD CONSTRAINT "knowledge_evolution_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_knowledge_document_id_knowledge_documents_id_fk" FOREIGN KEY ("knowledge_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_knowledge_topic_id_knowledge_topics_id_fk" FOREIGN KEY ("knowledge_topic_id") REFERENCES "public"."knowledge_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_pipeline_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("pipeline_execution_id") REFERENCES "public"."pipeline_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_prospect_property_id_prospect_properties_id_fk" FOREIGN KEY ("prospect_property_id") REFERENCES "public"."prospect_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_deployment_id_app_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."app_deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_output_knowledge" ADD CONSTRAINT "job_output_knowledge_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_output_knowledge" ADD CONSTRAINT "job_output_knowledge_pipeline_step_execution_id_pipeline_step_executions_id_fk" FOREIGN KEY ("pipeline_step_execution_id") REFERENCES "public"."pipeline_step_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_output_knowledge" ADD CONSTRAINT "job_output_knowledge_knowledge_document_id_knowledge_documents_id_fk" FOREIGN KEY ("knowledge_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_output_knowledge" ADD CONSTRAINT "job_output_knowledge_knowledge_topic_id_knowledge_topics_id_fk" FOREIGN KEY ("knowledge_topic_id") REFERENCES "public"."knowledge_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_output_knowledge" ADD CONSTRAINT "job_output_knowledge_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_asset" ADD CONSTRAINT "rag_asset_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_asset" ADD CONSTRAINT "rag_asset_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_asset" ADD CONSTRAINT "rag_asset_knowledge_topic_id_knowledge_topics_id_fk" FOREIGN KEY ("knowledge_topic_id") REFERENCES "public"."knowledge_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_asset" ADD CONSTRAINT "rag_asset_knowledge_document_id_knowledge_documents_id_fk" FOREIGN KEY ("knowledge_document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_webhook_subscriptions" ADD CONSTRAINT "event_webhook_subscriptions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_log" ADD CONSTRAINT "webhook_delivery_log_subscription_id_event_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."event_webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_sessions" ADD CONSTRAINT "analysis_sessions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_execution_history" ADD CONSTRAINT "query_execution_history_query_id_saved_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."saved_queries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_templates" ADD CONSTRAINT "query_templates_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_queries" ADD CONSTRAINT "saved_queries_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_events" ADD CONSTRAINT "rescue_events_session_id_rescue_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."rescue_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_sessions" ADD CONSTRAINT "rescue_sessions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_sessions" ADD CONSTRAINT "rescue_sessions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_sessions" ADD CONSTRAINT "rescue_sessions_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_sessions" ADD CONSTRAINT "rescue_sessions_culprit_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("culprit_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rescue_telemetry" ADD CONSTRAINT "rescue_telemetry_session_id_rescue_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."rescue_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_items" ADD CONSTRAINT "dataset_items_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_items" ADD CONSTRAINT "dataset_items_pipeline_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("pipeline_execution_id") REFERENCES "public"."pipeline_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_items" ADD CONSTRAINT "dataset_items_knowledge_node_id_knowledge_nodes_id_fk" FOREIGN KEY ("knowledge_node_id") REFERENCES "public"."knowledge_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_action_log" ADD CONSTRAINT "ontology_action_log_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_action_log" ADD CONSTRAINT "ontology_action_log_action_id_ontology_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."ontology_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_action_log" ADD CONSTRAINT "ontology_action_log_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_actions" ADD CONSTRAINT "ontology_actions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_actions" ADD CONSTRAINT "ontology_actions_object_type_id_ontology_object_types_id_fk" FOREIGN KEY ("object_type_id") REFERENCES "public"."ontology_object_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_object_types" ADD CONSTRAINT "ontology_object_types_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_objects" ADD CONSTRAINT "ontology_objects_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontology_objects" ADD CONSTRAINT "ontology_objects_object_type_id_ontology_object_types_id_fk" FOREIGN KEY ("object_type_id") REFERENCES "public"."ontology_object_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_analytics_daily" ADD CONSTRAINT "app_analytics_daily_deployment_id_app_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."app_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_command_events" ADD CONSTRAINT "copilot_command_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_command_events" ADD CONSTRAINT "copilot_command_events_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_source_reviews" ADD CONSTRAINT "copilot_source_reviews_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_tuning_datasets" ADD CONSTRAINT "fine_tuning_datasets_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_tuning_examples" ADD CONSTRAINT "fine_tuning_examples_dataset_id_fine_tuning_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."fine_tuning_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_tuning_examples" ADD CONSTRAINT "fine_tuning_examples_source_job_id_jobs_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_tuning_examples" ADD CONSTRAINT "fine_tuning_examples_source_pipeline_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("source_pipeline_execution_id") REFERENCES "public"."pipeline_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_tuning_preferences" ADD CONSTRAINT "fine_tuning_preferences_dataset_id_fine_tuning_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."fine_tuning_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fine_tuning_preferences" ADD CONSTRAINT "fine_tuning_preferences_source_job_id_jobs_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervention_memory" ADD CONSTRAINT "intervention_memory_threshold_id_score_thresholds_id_fk" FOREIGN KEY ("threshold_id") REFERENCES "public"."score_thresholds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_events" ADD CONSTRAINT "scoring_events_rule_id_scoring_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."scoring_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_events" ADD CONSTRAINT "scoring_events_threshold_id_score_thresholds_id_fk" FOREIGN KEY ("threshold_id") REFERENCES "public"."score_thresholds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_agent_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_run_results" ADD CONSTRAINT "evaluation_run_results_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_run_results" ADD CONSTRAINT "evaluation_run_results_test_case_id_evaluation_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."evaluation_test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_test_set_id_evaluation_test_sets_id_fk" FOREIGN KEY ("test_set_id") REFERENCES "public"."evaluation_test_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_test_cases" ADD CONSTRAINT "evaluation_test_cases_test_set_id_evaluation_test_sets_id_fk" FOREIGN KEY ("test_set_id") REFERENCES "public"."evaluation_test_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_test_cases" ADD CONSTRAINT "evaluation_test_cases_source_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("source_mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_test_sets" ADD CONSTRAINT "evaluation_test_sets_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_test_sets" ADD CONSTRAINT "evaluation_test_sets_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_critiques" ADD CONSTRAINT "video_critiques_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_effectiveness_aggregates" ADD CONSTRAINT "component_effectiveness_aggregates_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_usage_records" ADD CONSTRAINT "component_usage_records_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_ab_tests" ADD CONSTRAINT "prompt_ab_tests_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_performance_logs" ADD CONSTRAINT "prompt_performance_logs_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_clusters" ADD CONSTRAINT "failure_clusters_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_incidents" ADD CONSTRAINT "failure_incidents_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_incidents" ADD CONSTRAINT "failure_incidents_cluster_id_failure_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."failure_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prevention_rules" ADD CONSTRAINT "prevention_rules_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_learning_profiles" ADD CONSTRAINT "org_learning_profiles_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_preference_events" ADD CONSTRAINT "org_preference_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memetic_graph" ADD CONSTRAINT "memetic_graph_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memetic_graph" ADD CONSTRAINT "memetic_graph_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quant_branch_influences" ADD CONSTRAINT "quant_branch_influences_quant_id_quants_id_fk" FOREIGN KEY ("quant_id") REFERENCES "public"."quants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quant_hidden_state_influences" ADD CONSTRAINT "quant_hidden_state_influences_quant_id_quants_id_fk" FOREIGN KEY ("quant_id") REFERENCES "public"."quants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quant_realm_contributions" ADD CONSTRAINT "quant_realm_contributions_quant_id_quants_id_fk" FOREIGN KEY ("quant_id") REFERENCES "public"."quants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quant_relationships" ADD CONSTRAINT "quant_relationships_source_quant_id_quants_id_fk" FOREIGN KEY ("source_quant_id") REFERENCES "public"."quants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quant_relationships" ADD CONSTRAINT "quant_relationships_target_quant_id_quants_id_fk" FOREIGN KEY ("target_quant_id") REFERENCES "public"."quants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_branches" ADD CONSTRAINT "prediction_branches_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_contracts" ADD CONSTRAINT "prediction_contracts_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_source_node_id_graph_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_target_node_id_graph_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hidden_state_candidates" ADD CONSTRAINT "hidden_state_candidates_estimate_id_hidden_state_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."hidden_state_estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_corrections" ADD CONSTRAINT "event_corrections_original_event_id_canonical_events_id_fk" FOREIGN KEY ("original_event_id") REFERENCES "public"."canonical_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_corrections" ADD CONSTRAINT "event_corrections_correction_event_id_canonical_events_id_fk" FOREIGN KEY ("correction_event_id") REFERENCES "public"."canonical_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_deduplication_keys" ADD CONSTRAINT "event_deduplication_keys_event_id_canonical_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."canonical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_relations" ADD CONSTRAINT "context_relations_source_context_id_prediction_contexts_id_fk" FOREIGN KEY ("source_context_id") REFERENCES "public"."prediction_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_relations" ADD CONSTRAINT "context_relations_target_context_id_prediction_contexts_id_fk" FOREIGN KEY ("target_context_id") REFERENCES "public"."prediction_contexts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governance_audit_logs" ADD CONSTRAINT "governance_audit_logs_decision_id_governance_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."governance_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_outcomes" ADD CONSTRAINT "calibration_outcomes_outcome_id_observed_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."observed_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_outcomes" ADD CONSTRAINT "calibration_outcomes_outcome_match_id_outcome_matches_id_fk" FOREIGN KEY ("outcome_match_id") REFERENCES "public"."outcome_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_matches" ADD CONSTRAINT "outcome_matches_outcome_id_observed_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."observed_outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanation_audit_logs" ADD CONSTRAINT "explanation_audit_logs_explanation_id_prediction_explanations_id_fk" FOREIGN KEY ("explanation_id") REFERENCES "public"."prediction_explanations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanation_evidence" ADD CONSTRAINT "explanation_evidence_explanation_id_prediction_explanations_id_fk" FOREIGN KEY ("explanation_id") REFERENCES "public"."prediction_explanations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_roles_user_unique" ON "admin_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orgs_stripe_cust_idx" ON "orgs" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "orgs_sub_status_idx" ON "orgs" USING btree ("subscription_status");--> statement-breakpoint
CREATE INDEX "token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "int_log_platform_idx" ON "integration_logs" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "int_log_org_idx" ON "integration_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "int_log_created_at_idx" ON "integration_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "int_log_status_idx" ON "integration_logs" USING btree ("response_status");--> statement-breakpoint
CREATE INDEX "file_version_idx" ON "stored_file_versions" USING btree ("file_id","version_number");--> statement-breakpoint
CREATE INDEX "stored_file_path_idx" ON "stored_files" USING btree ("path");--> statement-breakpoint
CREATE INDEX "stored_file_org_idx" ON "stored_files" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stored_file_mime_idx" ON "stored_files" USING btree ("mime_type");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_file_org_path_unique" ON "stored_files" USING btree ("organization_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "system_dep_name_unique" ON "system_dependencies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "api_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_key_org_idx" ON "api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_spec_access_unq" ON "org_spec_access" USING btree ("org_id","spec_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saas_connector_org_platform_unq" ON "saas_connectors" USING btree ("org_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "saas_event_workflow_org_platform_id_unq" ON "saas_event_workflows" USING btree ("org_id","platform","workflow_id");--> statement-breakpoint
CREATE INDEX "saas_schema_snapshot_connector_idx" ON "saas_schema_snapshots" USING btree ("connector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saas_sync_config_connector_unq" ON "saas_sync_configs" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "slack_subscriptions_workspace_idx" ON "slack_channel_subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "slack_subscriptions_channel_idx" ON "slack_channel_subscriptions" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "slack_subscriptions_unique_idx" ON "slack_channel_subscriptions" USING btree ("workspace_id","channel_id");--> statement-breakpoint
CREATE INDEX "slack_commands_workspace_idx" ON "slack_commands" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "slack_commands_org_idx" ON "slack_commands" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "slack_commands_cmd_idx" ON "slack_commands" USING btree ("command");--> statement-breakpoint
CREATE INDEX "slack_commands_created_idx" ON "slack_commands" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "slack_interactions_workspace_idx" ON "slack_interactions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "slack_interactions_org_idx" ON "slack_interactions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "slack_interactions_action_idx" ON "slack_interactions" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "slack_interactions_target_idx" ON "slack_interactions" USING btree ("action_target_id");--> statement-breakpoint
CREATE INDEX "slack_notifications_workspace_idx" ON "slack_notifications" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "slack_notifications_org_idx" ON "slack_notifications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "slack_notifications_type_idx" ON "slack_notifications" USING btree ("type");--> statement-breakpoint
CREATE INDEX "slack_notifications_job_idx" ON "slack_notifications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "slack_notifications_mission_idx" ON "slack_notifications" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "slack_notifications_created_idx" ON "slack_notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "slack_user_context_user_team_idx" ON "slack_user_contexts" USING btree ("user_id","team_id");--> statement-breakpoint
CREATE INDEX "slack_workspaces_org_idx" ON "slack_workspaces" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "slack_workspaces_team_idx" ON "slack_workspaces" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "user_memory_user_idx" ON "user_memory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_memory_user_org_idx" ON "user_memory" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "idx_trycua_task_steps_task_step" ON "trycua_computer_use_task_steps" USING btree ("task_id","step_number");--> statement-breakpoint
CREATE INDEX "idx_trycua_task_steps_session_time" ON "trycua_computer_use_task_steps" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_trycua_task_steps_org_time" ON "trycua_computer_use_task_steps" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_trycua_tasks_org_status" ON "trycua_computer_use_tasks" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_trycua_tasks_session_time" ON "trycua_computer_use_tasks" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_trycua_tasks_user_time" ON "trycua_computer_use_tasks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_trycua_events_session_time" ON "trycua_session_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_trycua_events_org_time" ON "trycua_session_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_trycua_sessions_org_status" ON "trycua_sessions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_trycua_sessions_user_time" ON "trycua_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_trycua_sessions_expires" ON "trycua_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "llm_models_provider_idx" ON "llm_models" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "llm_models_org_idx" ON "llm_models" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "llm_models_model_idx" ON "llm_models" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "llm_models_active_idx" ON "llm_models" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "llm_models_capability_idx" ON "llm_models" USING btree ("capabilities");--> statement-breakpoint
CREATE INDEX "llm_provider_health_provider_idx" ON "llm_provider_health" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "llm_provider_health_status_idx" ON "llm_provider_health" USING btree ("status");--> statement-breakpoint
CREATE INDEX "llm_provider_health_circuit_idx" ON "llm_provider_health" USING btree ("circuit_open");--> statement-breakpoint
CREATE INDEX "llm_providers_org_idx" ON "llm_providers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "llm_providers_name_idx" ON "llm_providers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "llm_providers_active_idx" ON "llm_providers" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "llm_router_logs_org_idx" ON "llm_router_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "llm_router_logs_request_idx" ON "llm_router_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "llm_router_logs_job_idx" ON "llm_router_logs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "llm_router_logs_provider_idx" ON "llm_router_logs" USING btree ("selected_provider_id");--> statement-breakpoint
CREATE INDEX "llm_router_logs_model_idx" ON "llm_router_logs" USING btree ("selected_model_id");--> statement-breakpoint
CREATE INDEX "llm_router_logs_success_idx" ON "llm_router_logs" USING btree ("success");--> statement-breakpoint
CREATE INDEX "llm_router_logs_created_idx" ON "llm_router_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_routing_rules_org_idx" ON "llm_routing_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "llm_routing_rules_priority_idx" ON "llm_routing_rules" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "llm_routing_rules_active_idx" ON "llm_routing_rules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "encrypted_creds_entity_idx" ON "encrypted_credentials" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "encrypted_creds_type_idx" ON "encrypted_credentials" USING btree ("credential_type");--> statement-breakpoint
CREATE INDEX "encrypted_creds_org_idx" ON "encrypted_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "encrypted_creds_unique_idx" ON "encrypted_credentials" USING btree ("entity_type","entity_id","credential_type");--> statement-breakpoint
CREATE INDEX "idx_entity_versions_lookup" ON "entity_versions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_entity_versions_version" ON "entity_versions" USING btree ("entity_type","entity_id","version");--> statement-breakpoint
CREATE INDEX "idx_entity_versions_org" ON "entity_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "schedule_exec_scheduled_job_idx" ON "schedule_execution_history" USING btree ("scheduled_job_id");--> statement-breakpoint
CREATE INDEX "schedule_exec_status_idx" ON "schedule_execution_history" USING btree ("status");--> statement-breakpoint
CREATE INDEX "schedule_exec_scheduled_for_idx" ON "schedule_execution_history" USING btree ("scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_jobs_org_name_unique" ON "scheduled_jobs" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_org_name_unique" ON "schedules" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "idx_cost_ledger_org_recorded" ON "cost_ledger" USING btree ("org_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_cost_ledger_agent" ON "cost_ledger" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE INDEX "idx_cost_ledger_mission" ON "cost_ledger" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "idx_heartbeat_triggers_org" ON "heartbeat_triggers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_heartbeat_triggers_active" ON "heartbeat_triggers" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_heartbeat_triggers_agent" ON "heartbeat_triggers" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE INDEX "idx_alert_configs_org" ON "error_alert_configs" USING btree ("organization_id","enabled");--> statement-breakpoint
CREATE INDEX "idx_forensic_trace" ON "forensic_event_log" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_forensic_org_time" ON "forensic_event_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_forensic_status" ON "forensic_event_log" USING btree ("status") WHERE status IN ('failure', 'timeout');--> statement-breakpoint
CREATE INDEX "idx_forensic_job_type" ON "forensic_event_log" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "idx_audit_org" ON "audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_user" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_time" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_reasoning_mission_run" ON "reasoning_audits" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "idx_reasoning_trace" ON "reasoning_audits" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "idx_reasoning_status" ON "reasoning_audits" USING btree ("status");--> statement-breakpoint
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
CREATE UNIQUE INDEX "pipelines_org_name_unique" ON "pipelines" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "pipelines_governor_policy_idx" ON "pipelines" USING btree ("governor_policy_id");--> statement-breakpoint
CREATE INDEX "pipeline_steps_pipeline_id_idx" ON "pipeline_steps" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "pipeline_steps_job_id_idx" ON "pipeline_steps" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "pipeline_steps_fallback_job_id_idx" ON "pipeline_steps" USING btree ("fallback_job_id");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_pipeline_created_idx" ON "ai_usage_logs" USING btree ("pipeline_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_org_created_idx" ON "ai_usage_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_user_created_idx" ON "ai_usage_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_execution_idx" ON "ai_usage_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "pipeline_executions_status_idx" ON "pipeline_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pipeline_executions_pipeline_id_idx" ON "pipeline_executions" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "pipeline_executions_org_id_idx" ON "pipeline_executions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pipeline_executions_mission_id_idx" ON "pipeline_executions" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "pipeline_executions_started_at_idx" ON "pipeline_executions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "step_executions_execution_id_idx" ON "pipeline_step_executions" USING btree ("pipeline_execution_id");--> statement-breakpoint
CREATE INDEX "step_executions_step_id_idx" ON "pipeline_step_executions" USING btree ("pipeline_step_id");--> statement-breakpoint
CREATE INDEX "step_executions_job_id_idx" ON "pipeline_step_executions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "step_executions_status_idx" ON "pipeline_step_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_drift_pipeline" ON "drift_scores" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "idx_drift_org" ON "drift_scores" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "job_deps_job_id_idx" ON "job_dependencies" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_deps_depends_on_idx" ON "job_dependencies" USING btree ("depends_on_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_deps_unique_idx" ON "job_dependencies" USING btree ("job_id","depends_on_job_id");--> statement-breakpoint
CREATE INDEX "jobs_org_id_idx" ON "jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "jobs_output_dataset_id_idx" ON "jobs" USING btree ("output_dataset_id");--> statement-breakpoint
CREATE INDEX "jobs_output_topic_id_idx" ON "jobs" USING btree ("output_knowledge_topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_org_name_unique" ON "jobs" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "jobs_governor_policy_idx" ON "jobs" USING btree ("governor_policy_id");--> statement-breakpoint
CREATE INDEX "jobs_data_classification_idx" ON "jobs" USING btree ("organization_id","data_classification");--> statement-breakpoint
CREATE INDEX "job_history_job_id_idx" ON "job_request_history" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_history_org_id_idx" ON "job_request_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "job_history_created_at_idx" ON "job_request_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "token_agg_org_date_idx" ON "ai_token_daily_aggregation" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "token_usage_job_id_idx" ON "ai_token_usage" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "token_usage_org_id_idx" ON "ai_token_usage" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "token_usage_timestamp_idx" ON "ai_token_usage" USING btree ("request_timestamp");--> statement-breakpoint
CREATE INDEX "token_usage_model_idx" ON "ai_token_usage" USING btree ("model_name");--> statement-breakpoint
CREATE INDEX "active_runs_job_id_idx" ON "job_active_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "active_runs_status_idx" ON "job_active_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "active_runs_sse_idx" ON "job_active_runs" USING btree ("sse_channel_id");--> statement-breakpoint
CREATE INDEX "streaming_logs_job_run_idx" ON "job_streaming_logs" USING btree ("job_id","job_run_id");--> statement-breakpoint
CREATE INDEX "streaming_logs_timestamp_idx" ON "job_streaming_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "streaming_logs_org_idx" ON "job_streaming_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hil_patterns_job_id_idx" ON "hil_approval_patterns" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "hil_patterns_hash_idx" ON "hil_approval_patterns" USING btree ("request_hash");--> statement-breakpoint
CREATE INDEX "hil_patterns_org_idx" ON "hil_approval_patterns" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hil_escalation_approval_idx" ON "hil_escalation_log" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "hil_escalation_job_idx" ON "hil_escalation_log" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "hil_config_job_id_idx" ON "hil_job_config" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "hil_config_org_idx" ON "hil_job_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_chat_contexts_agent_idx" ON "agent_chat_contexts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_chat_contexts_user_idx" ON "agent_chat_contexts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_chat_contexts_template_idx" ON "agent_chat_contexts" USING btree ("is_template");--> statement-breakpoint
CREATE INDEX "agent_chat_messages_thread_idx" ON "agent_chat_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "agent_chat_messages_session_idx" ON "agent_chat_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_chat_messages_job_idx" ON "agent_chat_messages" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "agent_chat_messages_mission_idx" ON "agent_chat_messages" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "agent_chat_threads_agent_idx" ON "agent_chat_threads" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_chat_threads_user_idx" ON "agent_chat_threads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_chat_threads_status_idx" ON "agent_chat_threads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_mission_suggestions_mission" ON "mission_suggestions" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "idx_mission_suggestions_run" ON "mission_suggestions" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "ml_pred_strategy_idx" ON "ml_strategy_predictions" USING btree ("predicted_strategy");--> statement-breakpoint
CREATE INDEX "ml_pred_org_idx" ON "ml_strategy_predictions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ml_pred_agent_idx" ON "ml_strategy_predictions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "ml_pred_created_idx" ON "ml_strategy_predictions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ml_pred_success_idx" ON "ml_strategy_predictions" USING btree ("actual_success");--> statement-breakpoint
CREATE INDEX "model_version_idx" ON "strategy_model_versions" USING btree ("version");--> statement-breakpoint
CREATE INDEX "model_version_org_idx" ON "strategy_model_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "model_version_active_idx" ON "strategy_model_versions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "strategy_perf_strategy_idx" ON "strategy_performance_logs" USING btree ("strategy");--> statement-breakpoint
CREATE INDEX "strategy_perf_org_idx" ON "strategy_performance_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "strategy_perf_agent_idx" ON "strategy_performance_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "strategy_perf_created_idx" ON "strategy_performance_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_user_idx" ON "user_platform_identities" USING btree ("platform","platform_user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_representations_user_org_unique" ON "user_representations" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "user_representations_candidates_idx" ON "user_representations" USING btree ("turns_since_reconcile","last_reconciled_at");--> statement-breakpoint
CREATE INDEX "idx_agent_kg_org_agent_repo" ON "agent_knowledge_graph_entries" USING btree ("organization_id","agent_id","repository_id");--> statement-breakpoint
CREATE INDEX "idx_kb_questions_org_repo_status" ON "knowledge_base_questions" USING btree ("organization_id","repository_id","status");--> statement-breakpoint
CREATE INDEX "reflect_log_mission_run_idx" ON "reflection_logs" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "reflect_log_org_resolution_idx" ON "reflection_logs" USING btree ("organization_id","resolution");--> statement-breakpoint
CREATE INDEX "reflect_log_step_idx" ON "reflection_logs" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "reflect_log_created_at_idx" ON "reflection_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reflect_log_org_created_resolution_idx" ON "reflection_logs" USING btree ("organization_id","created_at","resolution");--> statement-breakpoint
CREATE INDEX "reflect_pattern_org_sig_idx" ON "reflection_patterns" USING btree ("organization_id","trigger_signature");--> statement-breakpoint
CREATE INDEX "reflect_pattern_type_idx" ON "reflection_patterns" USING btree ("pattern_type");--> statement-breakpoint
CREATE INDEX "reflect_pattern_active_success_idx" ON "reflection_patterns" USING btree ("is_active","success_rate");--> statement-breakpoint
CREATE INDEX "reflect_stats_org_date_unique_idx" ON "reflection_stats_daily" USING btree ("organization_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_deployments_slug_unique" ON "agent_deployments" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_deployments_job_unique" ON "agent_deployments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "agent_deployments_reports_to_idx" ON "agent_deployments" USING btree ("reports_to_id");--> statement-breakpoint
CREATE INDEX "agent_deployments_org_hierarchy_idx" ON "agent_deployments" USING btree ("organization_id","reports_to_id");--> statement-breakpoint
CREATE INDEX "shortlink_clicks_shortlink_idx" ON "shortlink_clicks" USING btree ("shortlink_id");--> statement-breakpoint
CREATE INDEX "shortlink_clicks_time_idx" ON "shortlink_clicks" USING btree ("clicked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shortlinks_code_unique" ON "shortlinks" USING btree ("code");--> statement-breakpoint
CREATE INDEX "shortlinks_resource_idx" ON "shortlinks" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "shortlinks_org_idx" ON "shortlinks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "shortlinks_expires_idx" ON "shortlinks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_governor_policies_org_id" ON "governor_policies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_governor_policies_is_active" ON "governor_policies" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_governor_policy_rules_policy_id" ON "governor_policy_rules" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "idx_spend_events_agent" ON "agent_spend_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_spend_events_org" ON "agent_spend_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_spend_events_timestamp" ON "agent_spend_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_gov_salaries_agent" ON "governance_agent_salaries" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_gov_salaries_org" ON "governance_agent_salaries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gov_approvals_org" ON "governance_approvals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gov_approvals_status" ON "governance_approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_gov_budget_policies_org" ON "governance_budget_policies" USING btree ("organization_id");--> statement-breakpoint
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
CREATE INDEX "idx_agent_policy_bundles_org" ON "agent_policy_bundles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_agent_policy_bundles_status" ON "agent_policy_bundles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_policy_violations_org" ON "policy_violations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_policy_violations_occurred_at" ON "policy_violations" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_policy_violations_check_type" ON "policy_violations" USING btree ("check_type");--> statement-breakpoint
CREATE INDEX "idx_performances_org" ON "agent_performances" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_upskilling_pip" ON "agent_upskilling_jobs" USING btree ("pip_id");--> statement-breakpoint
CREATE INDEX "idx_pips_agent" ON "performance_improvement_plans" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_pips_org" ON "performance_improvement_plans" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_pips_status" ON "performance_improvement_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_requests_execution_idx" ON "approval_requests" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "approval_requests_email_idx" ON "approval_requests" USING btree ("approver_email");--> statement-breakpoint
CREATE INDEX "approval_requests_user_idx" ON "approval_requests" USING btree ("approver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_token_idx" ON "approval_requests" USING btree ("token");--> statement-breakpoint
CREATE INDEX "approval_requests_org_idx" ON "approval_requests" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "approval_requests_mission_idx" ON "approval_requests" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "idx_approvals_knowledge" ON "approval_requests" USING btree ("knowledge_node_id");--> statement-breakpoint
CREATE INDEX "hil_forms_org_idx" ON "hil_forms" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "hil_forms_created_by_idx" ON "hil_forms" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "otp_codes_execution_idx" ON "otp_codes" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "otp_codes_email_idx" ON "otp_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "otp_codes_expires_idx" ON "otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mcp_token_user_idx" ON "mcp_api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_token_org_idx" ON "mcp_api_tokens" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_token_hash_unique" ON "mcp_api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mcp_token_prefix_idx" ON "mcp_api_tokens" USING btree ("token_prefix");--> statement-breakpoint
CREATE INDEX "mcp_token_active_idx" ON "mcp_api_tokens" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "prospect_event_profile_idx" ON "prospect_events" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "prospect_event_org_idx" ON "prospect_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "prospect_event_type_idx" ON "prospect_events" USING btree ("activity");--> statement-breakpoint
CREATE INDEX "prospect_lead_profile_idx" ON "prospect_leads" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "prospect_lead_org_idx" ON "prospect_leads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "prospect_profile_org_uid_idx" ON "prospect_profiles" USING btree ("organization_id","uid");--> statement-breakpoint
CREATE INDEX "prospect_profile_prop_idx" ON "prospect_profiles" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "prospect_profile_user_idx" ON "prospect_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prospect_prop_org_idx" ON "prospect_properties" USING btree ("organization_id");--> statement-breakpoint
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
CREATE INDEX "idx_blackboard_history_mission_id" ON "mission_blackboard_history" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "idx_mission_members_mission_id" ON "mission_members" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "idx_mission_members_entity" ON "mission_members" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_missions_organization_id" ON "missions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_missions_deleted_at" ON "missions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_missions_source_template_id" ON "missions" USING btree ("source_template_id");--> statement-breakpoint
CREATE INDEX "idx_missions_ticket" ON "missions" USING btree ("external_ticket_id");--> statement-breakpoint
CREATE INDEX "mission_retro_run_idx" ON "mission_retrospectives" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "mission_retro_mission_idx" ON "mission_retrospectives" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "mission_runs_mission_id_idx" ON "mission_runs" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "mission_runs_pipeline_execution_idx" ON "mission_runs" USING btree ("pipeline_execution_id");--> statement-breakpoint
CREATE INDEX "mission_shadow_parent_idx" ON "mission_shadow_runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "mission_step_assign_run_idx" ON "mission_step_assignments" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "mission_step_assign_execution_idx" ON "mission_step_assignments" USING btree ("pipeline_execution_id");--> statement-breakpoint
CREATE INDEX "template_proposals_org_status_idx" ON "template_proposals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "template_proposals_template_idx" ON "template_proposals" USING btree ("source_template_id");--> statement-breakpoint
CREATE INDEX "template_proposals_run_idx" ON "template_proposals" USING btree ("source_mission_run_id");--> statement-breakpoint
CREATE INDEX "mab_mission_idx" ON "mission_app_bindings" USING btree ("mission_id","sort_order");--> statement-breakpoint
CREATE INDEX "mab_org_idx" ON "mission_app_bindings" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mab_unique" ON "mission_app_bindings" USING btree ("mission_id","app_id","role");--> statement-breakpoint
CREATE INDEX "idx_maa_run" ON "mission_agent_assignments" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "idx_maa_agent" ON "mission_agent_assignments" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_maa_run_agent" ON "mission_agent_assignments" USING btree ("mission_run_id","agent_deployment_id");--> statement-breakpoint
CREATE INDEX "agora_mission_idx" ON "agora_sessions" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "swarm_bids_task_idx" ON "swarm_bids" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "swarm_tasks_mission_idx" ON "swarm_tasks" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "swarm_tasks_status_idx" ON "swarm_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "app_audit_logs_app_idx" ON "app_audit_logs" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "app_audit_logs_org_idx" ON "app_audit_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "app_audits_app_idx" ON "app_audits" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "app_audits_job_idx" ON "app_audits" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_deployment_org_app_unq" ON "app_deployments" USING btree ("organization_id","app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_deployment_public_slug_unq" ON "app_deployments" USING btree ("public_slug");--> statement-breakpoint
CREATE INDEX "app_deployments_published_idx" ON "app_deployments" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX "app_deployments_public_slug_idx" ON "app_deployments" USING btree ("public_slug");--> statement-breakpoint
CREATE INDEX "app_instances_deployment_idx" ON "app_instances" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "app_instances_status_idx" ON "app_instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "app_payouts_dev_org_idx" ON "app_payouts" USING btree ("developer_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_payouts_unique_run" ON "app_payouts" USING btree ("app_id","mission_run_id");--> statement-breakpoint
CREATE INDEX "app_records_collection_idx" ON "app_records" USING btree ("app_id","org_id","collection");--> statement-breakpoint
CREATE UNIQUE INDEX "app_records_unique_record" ON "app_records" USING btree ("app_id","org_id","collection","record_id");--> statement-breakpoint
CREATE INDEX "app_telemetry_app_idx" ON "app_telemetry" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "app_telemetry_org_idx" ON "app_telemetry" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_usage_deployment_user_unq" ON "app_user_usage" USING btree ("deployment_id","user_id");--> statement-breakpoint
CREATE INDEX "app_versions_app_idx" ON "app_versions" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "app_versions_org_idx" ON "app_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_versions_commit_hash_idx" ON "app_versions" USING btree ("app_id","commit_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "app_versions_version_number_idx" ON "app_versions" USING btree ("app_id","version_number");--> statement-breakpoint
CREATE INDEX "app_versions_branch_idx" ON "app_versions" USING btree ("app_id","branch");--> statement-breakpoint
CREATE UNIQUE INDEX "app_slug_unique" ON "apps" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "consistency_remediation_config_org_id_idx" ON "consistency_remediation_config" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "health_check_config_org_id_idx" ON "health_check_config" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "health_check_instance_id_idx" ON "health_check_results" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "health_check_timestamp_idx" ON "health_check_results" USING btree ("check_timestamp");--> statement-breakpoint
CREATE INDEX "health_check_org_id_idx" ON "health_check_results" USING btree ("org_id");--> statement-breakpoint
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
CREATE INDEX "blueprint_templates_blueprint_id_idx" ON "blueprint_templates" USING btree ("blueprint_id");--> statement-breakpoint
CREATE INDEX "blueprint_templates_org_id_idx" ON "blueprint_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_templates_org_name_unique" ON "blueprint_templates" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_slug_unq" ON "blueprints" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "template_executions_template_id_idx" ON "template_executions" USING btree ("blueprint_template_id");--> statement-breakpoint
CREATE INDEX "template_executions_org_id_idx" ON "template_executions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "template_executions_pipeline_execution_id_idx" ON "template_executions" USING btree ("pipeline_execution_id");--> statement-breakpoint
CREATE INDEX "template_executions_status_idx" ON "template_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "template_executions_created_at_idx" ON "template_executions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "resource_edges_source_idx" ON "resource_edges" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "resource_edges_target_idx" ON "resource_edges" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "resource_edges_org_idx" ON "resource_edges" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_edges_org_relation_unique" ON "resource_edges" USING btree ("organization_id","source_type","source_id","relation_type","target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_gen_sessions_org" ON "generation_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gen_sessions_status" ON "generation_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_gen_sessions_cycle" ON "generation_sessions" USING btree ("cycle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_artifact_unique" ON "artifact_registry" USING btree ("session_id","phase","name","version");--> statement-breakpoint
CREATE INDEX "idx_artifact_session" ON "artifact_registry" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_artifact_phase" ON "artifact_registry" USING btree ("session_id","phase");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_doc_file_state_org_path_idx" ON "capability_doc_file_state" USING btree ("organization_id","doc_path");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_sync_state_org_cap_idx" ON "capability_sync_state" USING btree ("organization_id","capability_id");--> statement-breakpoint
CREATE INDEX "capability_sync_state_signature_idx" ON "capability_sync_state" USING btree ("signature_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_concepts_org_name_unique" ON "knowledge_concepts" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_docs_org_title_unique" ON "knowledge_documents" USING btree ("organization_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_docs_integration_external_unq" ON "knowledge_documents" USING btree ("organization_id","integration_id","external_id") WHERE integration_id IS NOT NULL AND external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "knowledge_docs_dataset_item_idx" ON "knowledge_documents" USING btree ("dataset_item_id");--> statement-breakpoint
CREATE INDEX "knowledge_docs_workflow_execution_idx" ON "knowledge_documents" USING btree ("workflow_execution_id");--> statement-breakpoint
CREATE INDEX "knowledge_docs_workflow_step_idx" ON "knowledge_documents" USING btree ("workflow_step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_policy_concept_rule_unique" ON "knowledge_policy_constraints" USING btree ("concept_id","policy_rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_smes_concept_user_unique" ON "knowledge_smes" USING btree ("concept_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_topics_org_name_unique" ON "knowledge_topics" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "batch_status_idx" ON "extraction_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "batch_org_idx" ON "extraction_batches" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_schema_name_org_unique" ON "graph_schema_defs" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "edge_source_idx" ON "knowledge_edges" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "edge_target_idx" ON "knowledge_edges" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "edge_org_idx" ON "knowledge_edges" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "edge_prop_idx" ON "knowledge_edges" USING btree ("prospect_property_id");--> statement-breakpoint
CREATE INDEX "edge_mission_idx" ON "knowledge_edges" USING btree ("mission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "edge_source_target_relation_unique" ON "knowledge_edges" USING btree ("source_id","target_id","relation");--> statement-breakpoint
CREATE INDEX "evolution_org_idx" ON "knowledge_evolution_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "evolution_type_idx" ON "knowledge_evolution_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "node_label_idx" ON "knowledge_nodes" USING btree ("label");--> statement-breakpoint
CREATE INDEX "node_name_idx" ON "knowledge_nodes" USING btree ("name");--> statement-breakpoint
CREATE INDEX "node_org_idx" ON "knowledge_nodes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "node_prop_idx" ON "knowledge_nodes" USING btree ("prospect_property_id");--> statement-breakpoint
CREATE INDEX "node_mission_idx" ON "knowledge_nodes" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "node_topic_idx" ON "knowledge_nodes" USING btree ("knowledge_topic_id");--> statement-breakpoint
CREATE INDEX "node_app_idx" ON "knowledge_nodes" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "node_deployment_idx" ON "knowledge_nodes" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "node_verification_idx" ON "knowledge_nodes" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "node_temporal_idx" ON "knowledge_nodes" USING btree ("source_created_at");--> statement-breakpoint
CREATE INDEX "node_updated_temporal_idx" ON "knowledge_nodes" USING btree ("source_updated_at");--> statement-breakpoint
CREATE INDEX "knowledge_nodes_embedding_contract_idx" ON "knowledge_nodes" USING btree ("organization_id","embedding_provider","embedding_model","embedding_dimensions","embedding_version");--> statement-breakpoint
CREATE UNIQUE INDEX "node_org_label_external_id_unique" ON "knowledge_nodes" USING btree ("organization_id","label","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "node_org_fingerprint_unique" ON "knowledge_nodes" USING btree ("organization_id","fingerprint") WHERE fingerprint IS NOT NULL;--> statement-breakpoint
CREATE INDEX "event_type_idx" ON "event_log" USING btree ("type");--> statement-breakpoint
CREATE INDEX "event_source_idx" ON "event_log" USING btree ("source");--> statement-breakpoint
CREATE INDEX "event_time_idx" ON "event_log" USING btree ("emitted_at");--> statement-breakpoint
CREATE INDEX "webhook_sub_event_type_idx" ON "event_webhook_subscriptions" USING btree ("event_type_pattern");--> statement-breakpoint
CREATE INDEX "webhook_sub_active_idx" ON "event_webhook_subscriptions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "webhook_sub_org_idx" ON "event_webhook_subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_sub_idx" ON "webhook_delivery_log" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_event_idx" ON "webhook_delivery_log" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_status_idx" ON "webhook_delivery_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "analysis_session_org_idx" ON "analysis_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "snapshot_entity_idx" ON "snapshots" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "snapshot_job_idx" ON "snapshots" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "snapshot_primary_idx" ON "snapshots" USING btree ("entity_type","entity_id","is_primary");--> statement-breakpoint
CREATE INDEX "query_execution_history_query_idx" ON "query_execution_history" USING btree ("query_id");--> statement-breakpoint
CREATE INDEX "query_templates_org_idx" ON "query_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "saved_queries_org_idx" ON "saved_queries" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "datasets_org_name_unique" ON "datasets" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "idx_datasets_mission" ON "datasets" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "ontology_action_log_org_idx" ON "ontology_action_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ontology_action_log_run_idx" ON "ontology_action_log" USING btree ("mission_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ontology_action_org_name_unique" ON "ontology_actions" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "ontology_action_org_idx" ON "ontology_actions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ontology_object_type_org_name_unique" ON "ontology_object_types" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "ontology_object_type_org_idx" ON "ontology_object_types" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ontology_object_org_type_extid_unique" ON "ontology_objects" USING btree ("organization_id","object_type_id","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ontology_object_org_type_idx" ON "ontology_objects" USING btree ("organization_id","object_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_analytics_deployment_date_unq" ON "app_analytics_daily" USING btree ("deployment_id","date");--> statement-breakpoint
CREATE INDEX "copilot_command_events_org_created_idx" ON "copilot_command_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "copilot_command_events_command_idx" ON "copilot_command_events" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "copilot_source_reviews_org_source_idx" ON "copilot_source_reviews" USING btree ("organization_id","source_id");--> statement-breakpoint
CREATE INDEX "copilot_source_reviews_org_created_idx" ON "copilot_source_reviews" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_tool_invocations_job" ON "tool_invocations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_tool_invocations_org" ON "tool_invocations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_tool_invocations_invoked_at" ON "tool_invocations" USING btree ("invoked_at");--> statement-breakpoint
CREATE INDEX "idx_tool_invocations_tool_name" ON "tool_invocations" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "idx_scoring_run" ON "scoring_events" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "idx_scoring_agent" ON "scoring_events" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE INDEX "idx_ps_agent" ON "performance_snapshots" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE INDEX "idx_ps_run" ON "performance_snapshots" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "idx_ps_captured" ON "performance_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "evaluation_test_cases_source_run_idx" ON "evaluation_test_cases" USING btree ("source_mission_run_id");--> statement-breakpoint
CREATE INDEX "evaluation_test_sets_mission_idx" ON "evaluation_test_sets" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "comp_eff_org_component_unique_idx" ON "component_effectiveness_aggregates" USING btree ("organization_id","component_name");--> statement-breakpoint
CREATE INDEX "comp_eff_category_score_idx" ON "component_effectiveness_aggregates" USING btree ("component_category","avg_effectiveness_rating");--> statement-breakpoint
CREATE INDEX "comp_usage_org_component_idx" ON "component_usage_records" USING btree ("organization_id","component_name");--> statement-breakpoint
CREATE INDEX "comp_usage_category_idx" ON "component_usage_records" USING btree ("component_category");--> statement-breakpoint
CREATE INDEX "comp_usage_app_idx" ON "component_usage_records" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "comp_usage_mission_idx" ON "component_usage_records" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "prompt_ab_org_status_idx" ON "prompt_ab_tests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "prompt_perf_org_version_idx" ON "prompt_performance_logs" USING btree ("organization_id","prompt_version_id");--> statement-breakpoint
CREATE INDEX "prompt_perf_mission_idx" ON "prompt_performance_logs" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "prompt_perf_created_at_idx" ON "prompt_performance_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "prompt_ver_org_type_version_idx" ON "prompt_versions" USING btree ("organization_id","prompt_type","version_id");--> statement-breakpoint
CREATE INDEX "prompt_ver_status_fitness_idx" ON "prompt_versions" USING btree ("status","fitness_score");--> statement-breakpoint
CREATE INDEX "prompt_ver_ab_test_idx" ON "prompt_versions" USING btree ("ab_test_id");--> statement-breakpoint
CREATE INDEX "failure_cluster_org_sig_idx" ON "failure_clusters" USING btree ("organization_id","cluster_signature");--> statement-breakpoint
CREATE INDEX "failure_cluster_domain_sev_idx" ON "failure_clusters" USING btree ("domain","severity");--> statement-breakpoint
CREATE INDEX "failure_cluster_status_freq_idx" ON "failure_clusters" USING btree ("status","frequency_7d");--> statement-breakpoint
CREATE INDEX "failure_inc_org_hash_idx" ON "failure_incidents" USING btree ("organization_id","incident_hash");--> statement-breakpoint
CREATE INDEX "failure_inc_cluster_idx" ON "failure_incidents" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "failure_inc_domain_severity_idx" ON "failure_incidents" USING btree ("domain","severity");--> statement-breakpoint
CREATE INDEX "failure_inc_created_at_idx" ON "failure_incidents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "failure_inc_app_idx" ON "failure_incidents" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "prevention_rule_org_active_idx" ON "prevention_rules" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "prevention_rule_cluster_idx" ON "prevention_rules" USING btree ("matches_cluster_id");--> statement-breakpoint
CREATE INDEX "cross_org_pattern_type_idx" ON "cross_org_insights" USING btree ("pattern_type");--> statement-breakpoint
CREATE INDEX "cross_org_strength_idx" ON "cross_org_insights" USING btree ("recommendation_strength");--> statement-breakpoint
CREATE INDEX "org_profile_org_unique_idx" ON "org_learning_profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_profile_learning_idx" ON "org_learning_profiles" USING btree ("learning_enabled");--> statement-breakpoint
CREATE INDEX "org_pref_event_org_cat_idx" ON "org_preference_events" USING btree ("organization_id","category");--> statement-breakpoint
CREATE INDEX "org_pref_event_type_idx" ON "org_preference_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "org_pref_event_created_idx" ON "org_preference_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_memetic_run" ON "memetic_graph" USING btree ("mission_run_id");--> statement-breakpoint
CREATE INDEX "idx_intent_user" ON "contact_intent_states" USING btree ("user_fingerprint");--> statement-breakpoint
CREATE INDEX "idx_intent_time" ON "contact_intent_states" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_eng_user" ON "engagement_logs" USING btree ("user_fingerprint");--> statement-breakpoint
CREATE INDEX "idx_eng_time" ON "engagement_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_quant_branch_influences_quant" ON "quant_branch_influences" USING btree ("quant_id");--> statement-breakpoint
CREATE INDEX "idx_quant_branch_influences_branch" ON "quant_branch_influences" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_quant_field_context_time" ON "quant_field_summaries" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_quant_field_window" ON "quant_field_summaries" USING btree ("window_id");--> statement-breakpoint
CREATE INDEX "idx_quant_hs_influences_quant" ON "quant_hidden_state_influences" USING btree ("quant_id");--> statement-breakpoint
CREATE INDEX "idx_quant_hs_influences_state" ON "quant_hidden_state_influences" USING btree ("hidden_state_id");--> statement-breakpoint
CREATE INDEX "idx_quant_realm_contrib_quant" ON "quant_realm_contributions" USING btree ("quant_id");--> statement-breakpoint
CREATE INDEX "idx_quant_realm_contrib_context" ON "quant_realm_contributions" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_quant_relationships_source" ON "quant_relationships" USING btree ("source_quant_id");--> statement-breakpoint
CREATE INDEX "idx_quant_relationships_target" ON "quant_relationships" USING btree ("target_quant_id");--> statement-breakpoint
CREATE INDEX "idx_quant_relationships_context" ON "quant_relationships" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_quant_relationships_type" ON "quant_relationships" USING btree ("relationship_type");--> statement-breakpoint
CREATE INDEX "idx_quants_context_status" ON "quants" USING btree ("context_id","status");--> statement-breakpoint
CREATE INDEX "idx_quants_context_updated" ON "quants" USING btree ("context_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_quants_type" ON "quants" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_quants_lifecycle" ON "quants" USING btree ("lifecycle_status");--> statement-breakpoint
CREATE INDEX "idx_plugin_registry_capability" ON "plugin_registry" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "idx_plugin_registry_pod_subpod" ON "plugin_registry" USING btree ("pod","sub_pod");--> statement-breakpoint
CREATE INDEX "idx_plugin_registry_rollout" ON "plugin_registry" USING btree ("rollout_status");--> statement-breakpoint
CREATE INDEX "idx_plugin_runs_context_time" ON "plugin_runs" USING btree ("context_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_plugin_runs_plugin_time" ON "plugin_runs" USING btree ("plugin_name","started_at");--> statement-breakpoint
CREATE INDEX "idx_plugin_runs_status" ON "plugin_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_plugin_runs_request" ON "plugin_runs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_realm_agreement_context_time" ON "realm_agreements" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_realm_agreement_branch" ON "realm_agreements" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_realm_agreement_quant" ON "realm_agreements" USING btree ("quant_id");--> statement-breakpoint
CREATE INDEX "idx_realm_conflicts_context_time" ON "realm_conflicts" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_realm_conflicts_type" ON "realm_conflicts" USING btree ("conflict_type");--> statement-breakpoint
CREATE INDEX "idx_realm_contrib_context_time" ON "realm_contributions" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_realm_contrib_quant" ON "realm_contributions" USING btree ("quant_id");--> statement-breakpoint
CREATE INDEX "idx_realm_contrib_realm" ON "realm_contributions" USING btree ("realm");--> statement-breakpoint
CREATE INDEX "idx_realm_contrib_branch" ON "realm_contributions" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_branches_prediction" ON "prediction_branches" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_branches_context" ON "prediction_branches" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_prediction_branches_org_context" ON "prediction_branches" USING btree ("organization_id","context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_prediction_branches_status" ON "prediction_branches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_prediction_branches_predicate" ON "prediction_branches" USING btree ("predicate");--> statement-breakpoint
CREATE INDEX "idx_prediction_contracts_prediction" ON "prediction_contracts" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_contracts_context_time" ON "prediction_contracts" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_prediction_contracts_org_context_time" ON "prediction_contracts" USING btree ("organization_id","context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_predictions_context_time" ON "predictions" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_predictions_org_context_time" ON "predictions" USING btree ("organization_id","context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_predictions_top_predicate" ON "predictions" USING btree ("top_predicate");--> statement-breakpoint
CREATE INDEX "idx_predictions_entropy" ON "predictions" USING btree ("entropy");--> statement-breakpoint
CREATE INDEX "idx_source_perf_source" ON "source_performance_logs" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_source_perf_mission_type" ON "source_performance_logs" USING btree ("mission_type");--> statement-breakpoint
CREATE INDEX "idx_source_perf_org" ON "source_performance_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_branch_genealogy_branch" ON "branch_genealogy_events" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_branch_genealogy_prediction" ON "branch_genealogy_events" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "idx_branch_genealogy_context_time" ON "branch_genealogy_events" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_branch_score_breakdowns_branch" ON "branch_score_breakdowns" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_branch_score_breakdowns_prediction" ON "branch_score_breakdowns" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "idx_pruning_decisions_prediction" ON "pruning_decisions" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "idx_pruning_decisions_context_time" ON "pruning_decisions" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_pruning_decisions_branch" ON "pruning_decisions" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_pruning_decisions_type" ON "pruning_decisions" USING btree ("decision_type");--> statement-breakpoint
CREATE INDEX "idx_attractor_memories_type" ON "attractor_memories" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_attractor_memories_pull" ON "attractor_memories" USING btree ("pull_strength");--> statement-breakpoint
CREATE INDEX "idx_baseline_memories_context_type" ON "baseline_memories" USING btree ("context_id","baseline_type");--> statement-breakpoint
CREATE INDEX "idx_baseline_memories_scope" ON "baseline_memories" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "idx_historical_outcomes_context_time" ON "historical_outcomes" USING btree ("context_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_historical_outcomes_predicate" ON "historical_outcomes" USING btree ("predicted_predicate");--> statement-breakpoint
CREATE INDEX "idx_historical_outcomes_matched" ON "historical_outcomes" USING btree ("matched");--> statement-breakpoint
CREATE INDEX "idx_historical_outcomes_prediction" ON "historical_outcomes" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "idx_memory_recall_logs_context_time" ON "memory_recall_logs" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_pattern_memories_type" ON "pattern_memories" USING btree ("pattern_type");--> statement-breakpoint
CREATE INDEX "idx_pattern_memories_confidence" ON "pattern_memories" USING btree ("confidence");--> statement-breakpoint
CREATE INDEX "idx_graph_diffs_context_time" ON "graph_diffs" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_context_type" ON "graph_edges" USING btree ("context_id","type");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_source" ON "graph_edges" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_target" ON "graph_edges" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_weight" ON "graph_edges" USING btree ("weight");--> statement-breakpoint
CREATE INDEX "idx_graph_nodes_context_type" ON "graph_nodes" USING btree ("context_id","type");--> statement-breakpoint
CREATE INDEX "idx_graph_nodes_ref" ON "graph_nodes" USING btree ("ref_id");--> statement-breakpoint
CREATE INDEX "idx_graph_nodes_type" ON "graph_nodes" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_graph_snapshots_context_time" ON "graph_snapshots" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_graph_snapshots_type" ON "graph_snapshots" USING btree ("snapshot_type");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_candidates_estimate" ON "hidden_state_candidates" USING btree ("estimate_id");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_candidates_context" ON "hidden_state_candidates" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_candidates_label" ON "hidden_state_candidates" USING btree ("label");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_estimates_context_time" ON "hidden_state_estimates" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_estimates_top_label" ON "hidden_state_estimates" USING btree ("top_label");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_influences_state" ON "hidden_state_influences" USING btree ("hidden_state_id");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_influences_target" ON "hidden_state_influences" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_splits_context_time" ON "hidden_state_splits" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_transitions_context_time" ON "hidden_state_transitions" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_transitions_from" ON "hidden_state_transitions" USING btree ("from_state_id");--> statement-breakpoint
CREATE INDEX "idx_hidden_state_transitions_to" ON "hidden_state_transitions" USING btree ("to_state_id");--> statement-breakpoint
CREATE INDEX "idx_diff_records_context_time" ON "diff_records" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_diff_records_type" ON "diff_records" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_diff_records_realm" ON "diff_records" USING btree ("realm");--> statement-breakpoint
CREATE INDEX "idx_diff_records_significance" ON "diff_records" USING btree ("significance");--> statement-breakpoint
CREATE INDEX "idx_diff_snapshots_context_time" ON "diff_snapshots" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_diff_triggers_context_time" ON "diff_triggers" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_diff_triggers_type" ON "diff_triggers" USING btree ("trigger_type");--> statement-breakpoint
CREATE INDEX "idx_drift_records_context_time" ON "drift_records" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_drift_records_type" ON "drift_records" USING btree ("drift_type");--> statement-breakpoint
CREATE INDEX "idx_expected_event_gaps_context_type" ON "expected_event_gaps" USING btree ("context_id","event_type");--> statement-breakpoint
CREATE INDEX "idx_temporal_features_context_time" ON "temporal_features" USING btree ("context_id","observed_at");--> statement-breakpoint
CREATE INDEX "idx_temporal_features_event" ON "temporal_features" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_features_quant" ON "temporal_features" USING btree ("quant_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_relations_context" ON "temporal_relations" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_temporal_relations_source" ON "temporal_relations" USING btree ("source_ref_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_relations_target" ON "temporal_relations" USING btree ("target_ref_id");--> statement-breakpoint
CREATE INDEX "idx_temporal_relations_relation" ON "temporal_relations" USING btree ("relation");--> statement-breakpoint
CREATE INDEX "idx_window_summaries_context_time" ON "window_summaries" USING btree ("context_id","start_time");--> statement-breakpoint
CREATE INDEX "idx_window_summaries_type" ON "window_summaries" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_window_summaries_density_mode" ON "window_summaries" USING btree ("density_mode");--> statement-breakpoint
CREATE INDEX "idx_canonical_events_context_time" ON "canonical_events" USING btree ("context_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_canonical_events_source" ON "canonical_events" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_canonical_events_action" ON "canonical_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_canonical_events_kind" ON "canonical_events" USING btree ("event_kind");--> statement-breakpoint
CREATE INDEX "idx_event_corrections_original" ON "event_corrections" USING btree ("original_event_id");--> statement-breakpoint
CREATE INDEX "idx_event_dedup_keys_event" ON "event_deduplication_keys" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_rejections_source_time" ON "event_rejections" USING btree ("source","created_at");--> statement-breakpoint
CREATE INDEX "idx_event_rejections_code" ON "event_rejections" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_context_relations_source" ON "context_relations" USING btree ("source_context_id");--> statement-breakpoint
CREATE INDEX "idx_context_relations_target" ON "context_relations" USING btree ("target_context_id");--> statement-breakpoint
CREATE INDEX "idx_context_relations_type" ON "context_relations" USING btree ("relation_type");--> statement-breakpoint
CREATE INDEX "idx_context_resolution_logs_context" ON "context_resolution_logs" USING btree ("resolved_context_id");--> statement-breakpoint
CREATE INDEX "idx_context_resolution_logs_time" ON "context_resolution_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_prediction_contexts_tenant" ON "prediction_contexts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_contexts_actor" ON "prediction_contexts" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_contexts_workflow" ON "prediction_contexts" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_contexts_session" ON "prediction_contexts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_contexts_status" ON "prediction_contexts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_prediction_contexts_last_seen" ON "prediction_contexts" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_governance_audit_context_time" ON "governance_audit_logs" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_governance_audit_subject" ON "governance_audit_logs" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "idx_governance_audit_action" ON "governance_audit_logs" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "idx_governance_decisions_context_time" ON "governance_decisions" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_governance_decisions_subject" ON "governance_decisions" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "idx_governance_decisions_decision" ON "governance_decisions" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "idx_governance_decisions_risk" ON "governance_decisions" USING btree ("risk_class");--> statement-breakpoint
CREATE INDEX "idx_governance_policies_status" ON "governance_policies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_governance_policies_type" ON "governance_policies" USING btree ("policy_type");--> statement-breakpoint
CREATE INDEX "idx_governance_simulations_context_time" ON "governance_simulations" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_calibration_outcomes_prediction" ON "calibration_outcomes" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "idx_calibration_outcomes_context_time" ON "calibration_outcomes" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_calibration_outcomes_false_prune" ON "calibration_outcomes" USING btree ("false_prune");--> statement-breakpoint
CREATE INDEX "idx_calibration_outcomes_overconfident" ON "calibration_outcomes" USING btree ("overconfident");--> statement-breakpoint
CREATE INDEX "idx_calibration_signals_target" ON "calibration_signals" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_calibration_signals_context_time" ON "calibration_signals" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_calibration_signals_applied" ON "calibration_signals" USING btree ("applied");--> statement-breakpoint
CREATE INDEX "idx_observed_outcomes_context_time" ON "observed_outcomes" USING btree ("context_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_observed_outcomes_label" ON "observed_outcomes" USING btree ("label");--> statement-breakpoint
CREATE INDEX "idx_observed_outcomes_type" ON "observed_outcomes" USING btree ("outcome_type");--> statement-breakpoint
CREATE INDEX "idx_outcome_matches_outcome" ON "outcome_matches" USING btree ("outcome_id");--> statement-breakpoint
CREATE INDEX "idx_outcome_matches_prediction" ON "outcome_matches" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "idx_outcome_matches_context_time" ON "outcome_matches" USING btree ("context_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_plugin_reliability_plugin" ON "plugin_reliability_scores" USING btree ("plugin_name","plugin_version");--> statement-breakpoint
CREATE INDEX "idx_plugin_reliability_score" ON "plugin_reliability_scores" USING btree ("reliability_score");--> statement-breakpoint
CREATE INDEX "idx_realm_reliability_realm" ON "realm_reliability_scores" USING btree ("realm");--> statement-breakpoint
CREATE INDEX "idx_realm_reliability_score" ON "realm_reliability_scores" USING btree ("reliability_score");--> statement-breakpoint
CREATE INDEX "idx_explanation_audit_explanation" ON "explanation_audit_logs" USING btree ("explanation_id");--> statement-breakpoint
CREATE INDEX "idx_explanation_evidence_explanation" ON "explanation_evidence" USING btree ("explanation_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_explanations_prediction" ON "prediction_explanations" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "idx_prediction_explanations_context_time" ON "prediction_explanations" USING btree ("context_id","created_at");