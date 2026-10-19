-- DRIFT REPAIR: recreate the 30 tables the runtime baseline defines but that are
-- absent from at least one environment.
--
-- Same cause as 0058_scoring_events_prospect_index.sql, at a much larger scale:
-- the database was baselined — `20260717213750_baseline.sql` was marked applied
-- without being executed — against a snapshot that predated these tables. The
-- journal watermark is therefore ahead of every entry, so no later migration will
-- ever revisit them and nothing reports a problem.
--
-- The failure is silent in every case. Each of these tables has live server code
-- reading or writing it; the insert throws "relation does not exist" and is
-- swallowed by the surrounding try/catch. Confirmed dark subsystems:
--
--   generation_sessions, artifact_registry
--     The autonomous SDLC codegen pipeline. buildPhaseContext() cannot read a
--     phase context, so handleApplyEdits() never reaches
--     recordComponentAssemblyFeedback() — which is why every row in
--     component_index still carries its seeded effectiveness_score of 5.00 with
--     verification_run_count = 0. The component feedback loop is correct code
--     that has never had a table to run against.
--
--   agent_identities, agent_policy_bundles, agent_permission_grants,
--   agent_credential_leases, agent_governance_audit_events, policy_violations
--     Agent governance: identity, policy bundles, permission grants and the
--     audit trail. agent-identity-governance.service.ts and
--     policy-violation.service.ts both target tables that do not exist.
--
--   health_check_config, health_check_failures, health_check_results
--     Platform health checks.
--
--   failure_patterns          Self-harness failure clustering.
--   cycle_run_events          Per-step cycle telemetry (pipeline-step-runner.ts).
--   copilot_command_events, copilot_source_reviews   Copilot observability.
--   performance_snapshots, mission_agent_assignments,
--   agent_chat_threads, agent_chat_contexts
--   sales_*                   The sales domain (11 tables).
--
-- Every definition below is copied verbatim from the baseline and guarded, so an
-- environment the baseline did run against is left completely unchanged.

-- ── Enum types ──────────────────────────────────────────────────────
-- The sales tables are typed on these, and they drifted with them. CREATE TYPE
-- has no IF NOT EXISTS, so each is guarded the same way the constraints are.
DO $$ BEGIN
  BEGIN
    CREATE TYPE "public"."sales_activity_type" AS ENUM('REPLY', 'MEETING', 'DEMO', 'PROPOSAL_OPENED', 'CALL', 'EMAIL_SENT', 'STAGE_ADVANCED', 'NOTE');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "public"."sales_lead_status" AS ENUM('NEW', 'QUALIFYING', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "public"."sales_rearm_effect" AS ENUM('HOLD', 'REBASELINE', 'NONE');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "public"."sales_recommendation_kind" AS ENUM('slip_risk', 'stalled', 'aging', 'next_best_action', 'win', 'loss');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "public"."sales_recommendation_status" AS ENUM('OPEN', 'ACTED', 'SNOOZED', 'DISMISSED');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "public"."sales_stage" AS ENUM('PROSPECT', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "public"."sales_window_status" AS ENUM('ARMED', 'DECAYING', 'WON', 'LOST');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ── agent_chat_contexts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_chat_contexts" (
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

-- ── agent_chat_threads ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_chat_threads" (
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

-- ── agent_credential_leases ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_credential_leases" (
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

-- ── agent_governance_audit_events ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_governance_audit_events" (
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

-- ── agent_identities ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_identities" (
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

-- ── agent_permission_grants ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_permission_grants" (
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

-- ── agent_policy_bundles ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_policy_bundles" (
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

-- ── artifact_registry ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "artifact_registry" (
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

-- ── copilot_command_events ─────────────────────────────────────────────
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

-- ── copilot_source_reviews ─────────────────────────────────────────────
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

-- ── cycle_run_events ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cycle_run_events" (
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

-- ── failure_patterns ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "failure_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"harness_id" text NOT NULL,
	"harness_version" text NOT NULL,
	"pattern_signature" jsonb NOT NULL,
	"cluster_size" serial NOT NULL,
	"representative_traces" jsonb,
	"actionability_score" serial NOT NULL
);

-- ── generation_sessions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "generation_sessions" (
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

-- ── health_check_config ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "health_check_config" (
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

-- ── health_check_failures ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "health_check_failures" (
	"instance_id" integer PRIMARY KEY NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_time" timestamp with time zone,
	"last_successful_time" timestamp with time zone,
	"alert_sent_at" timestamp with time zone
);

-- ── health_check_results ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "health_check_results" (
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

-- ── mission_agent_assignments ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "mission_agent_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_run_id" integer NOT NULL,
	"agent_deployment_id" integer NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"config_snapshot" jsonb DEFAULT '{}'::jsonb,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);

-- ── performance_snapshots ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "performance_snapshots" (
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

-- ── policy_violations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "policy_violations" (
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

-- ── sales_accounts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_accounts" (
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

-- ── sales_activities ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_activities" (
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

-- ── sales_contacts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_contacts" (
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

-- ── sales_forecasts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_forecasts" (
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

-- ── sales_leads ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_leads" (
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

-- ── sales_opportunities ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_opportunities" (
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

-- ── sales_opportunity_windows ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_opportunity_windows" (
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

-- ── sales_quotas ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_quotas" (
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

-- ── sales_recommendations_domain ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_recommendations_domain" (
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

-- ── sales_stage_history ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_stage_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"opportunity_id" integer NOT NULL,
	"from_stage" "sales_stage",
	"to_stage" "sales_stage" NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"changed_by" text,
	"reason" text
);

-- ── sales_window_snapshots ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sales_window_snapshots" (
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

-- ── Foreign keys ────────────────────────────────────────────────
-- ADD CONSTRAINT has no IF NOT EXISTS, so each is guarded. A table that
-- already carries the constraint (any environment the baseline did run
-- against) is left untouched rather than erroring the whole migration.
DO $$ BEGIN
  BEGIN
    ALTER TABLE "agent_chat_contexts" ADD CONSTRAINT "agent_chat_contexts_agent_id_jobs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_chat_contexts" ADD CONSTRAINT "agent_chat_contexts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_chat_threads" ADD CONSTRAINT "agent_chat_threads_agent_id_jobs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_chat_threads" ADD CONSTRAINT "agent_chat_threads_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_credential_leases" ADD CONSTRAINT "agent_credential_leases_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_credential_leases" ADD CONSTRAINT "agent_credential_leases_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_governance_audit_events" ADD CONSTRAINT "agent_governance_audit_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_governance_audit_events" ADD CONSTRAINT "agent_governance_audit_events_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_permission_grants" ADD CONSTRAINT "agent_permission_grants_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_permission_grants" ADD CONSTRAINT "agent_permission_grants_agent_identity_id_agent_identities_id_fk" FOREIGN KEY ("agent_identity_id") REFERENCES "public"."agent_identities"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "agent_policy_bundles" ADD CONSTRAINT "agent_policy_bundles_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "artifact_registry" ADD CONSTRAINT "artifact_registry_session_id_generation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."generation_sessions"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "artifact_registry" ADD CONSTRAINT "artifact_registry_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "artifact_registry" ADD CONSTRAINT "artifact_registry_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "copilot_command_events" ADD CONSTRAINT "copilot_command_events_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "copilot_command_events" ADD CONSTRAINT "copilot_command_events_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "copilot_source_reviews" ADD CONSTRAINT "copilot_source_reviews_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "cycle_run_events" ADD CONSTRAINT "cycle_run_events_run_id_operational_cycles_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."operational_cycles"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "cycle_run_events" ADD CONSTRAINT "cycle_run_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_cycle_id_operational_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."operational_cycles"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "generation_sessions" ADD CONSTRAINT "generation_sessions_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "health_check_config" ADD CONSTRAINT "health_check_config_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "health_check_failures" ADD CONSTRAINT "health_check_failures_instance_id_app_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."app_instances"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_instance_id_app_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."app_instances"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_org_id_orgs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "mission_agent_assignments" ADD CONSTRAINT "mission_agent_assignments_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "mission_agent_assignments" ADD CONSTRAINT "mission_agent_assignments_agent_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_agent_deployment_id_agent_deployments_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "public"."agent_deployments"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "performance_snapshots" ADD CONSTRAINT "performance_snapshots_mission_run_id_mission_runs_id_fk" FOREIGN KEY ("mission_run_id") REFERENCES "public"."mission_runs"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "policy_violations" ADD CONSTRAINT "policy_violations_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_accounts" ADD CONSTRAINT "sales_accounts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_opportunity_id_sales_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_contacts" ADD CONSTRAINT "sales_contacts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_contacts" ADD CONSTRAINT "sales_contacts_account_id_sales_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sales_accounts"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_forecasts" ADD CONSTRAINT "sales_forecasts_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_prospect_lead_id_prospect_leads_id_fk" FOREIGN KEY ("prospect_lead_id") REFERENCES "public"."prospect_leads"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_converted_account_id_sales_accounts_id_fk" FOREIGN KEY ("converted_account_id") REFERENCES "public"."sales_accounts"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_leads" ADD CONSTRAINT "sales_leads_converted_contact_id_sales_contacts_id_fk" FOREIGN KEY ("converted_contact_id") REFERENCES "public"."sales_contacts"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_account_id_sales_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."sales_accounts"("id") ON DELETE restrict ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_lead_id_sales_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."sales_leads"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_opportunity_windows" ADD CONSTRAINT "sales_opportunity_windows_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_opportunity_windows" ADD CONSTRAINT "sales_opportunity_windows_opportunity_id_sales_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_quotas" ADD CONSTRAINT "sales_quotas_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_recommendations_domain" ADD CONSTRAINT "sales_recommendations_domain_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_recommendations_domain" ADD CONSTRAINT "sales_recommendations_domain_opportunity_id_sales_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_stage_history" ADD CONSTRAINT "sales_stage_history_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_stage_history" ADD CONSTRAINT "sales_stage_history_opportunity_id_sales_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_window_snapshots" ADD CONSTRAINT "sales_window_snapshots_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_window_snapshots" ADD CONSTRAINT "sales_window_snapshots_window_id_sales_opportunity_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."sales_opportunity_windows"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "sales_window_snapshots" ADD CONSTRAINT "sales_window_snapshots_opportunity_id_sales_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ── Indexes ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "agent_chat_contexts_agent_idx" ON "agent_chat_contexts" USING btree ("agent_id");
CREATE INDEX IF NOT EXISTS "agent_chat_contexts_user_idx" ON "agent_chat_contexts" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "agent_chat_contexts_template_idx" ON "agent_chat_contexts" USING btree ("is_template");
CREATE INDEX IF NOT EXISTS "agent_chat_threads_agent_idx" ON "agent_chat_threads" USING btree ("agent_id");
CREATE INDEX IF NOT EXISTS "agent_chat_threads_user_idx" ON "agent_chat_threads" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "agent_chat_threads_status_idx" ON "agent_chat_threads" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_agent_credential_leases_org" ON "agent_credential_leases" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_agent_credential_leases_identity" ON "agent_credential_leases" USING btree ("agent_identity_id");
CREATE INDEX IF NOT EXISTS "idx_agent_credential_leases_status" ON "agent_credential_leases" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_agent_credential_leases_expires" ON "agent_credential_leases" USING btree ("expires_at");
CREATE INDEX IF NOT EXISTS "idx_agent_gov_audit_org" ON "agent_governance_audit_events" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_agent_gov_audit_agent" ON "agent_governance_audit_events" USING btree ("agent_id");
CREATE INDEX IF NOT EXISTS "idx_agent_gov_audit_decision" ON "agent_governance_audit_events" USING btree ("decision");
CREATE INDEX IF NOT EXISTS "idx_agent_gov_audit_created" ON "agent_governance_audit_events" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_agent_identities_org" ON "agent_identities" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_agent_identities_agent" ON "agent_identities" USING btree ("agent_id");
CREATE INDEX IF NOT EXISTS "idx_agent_identities_status" ON "agent_identities" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_agent_permission_grants_org" ON "agent_permission_grants" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_agent_permission_grants_identity" ON "agent_permission_grants" USING btree ("agent_identity_id");
CREATE INDEX IF NOT EXISTS "idx_agent_permission_grants_tool_action" ON "agent_permission_grants" USING btree ("tool","action");
CREATE INDEX IF NOT EXISTS "idx_agent_policy_bundles_org" ON "agent_policy_bundles" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_agent_policy_bundles_status" ON "agent_policy_bundles" USING btree ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_artifact_unique" ON "artifact_registry" USING btree ("session_id","phase","name","version");
CREATE INDEX IF NOT EXISTS "idx_artifact_session" ON "artifact_registry" USING btree ("session_id");
CREATE INDEX IF NOT EXISTS "idx_artifact_phase" ON "artifact_registry" USING btree ("session_id","phase");
CREATE INDEX IF NOT EXISTS "copilot_command_events_org_created_idx" ON "copilot_command_events" USING btree ("organization_id","created_at");
CREATE INDEX IF NOT EXISTS "copilot_command_events_command_idx" ON "copilot_command_events" USING btree ("command_id");
CREATE INDEX IF NOT EXISTS "copilot_source_reviews_org_source_idx" ON "copilot_source_reviews" USING btree ("organization_id","source_id");
CREATE INDEX IF NOT EXISTS "copilot_source_reviews_org_created_idx" ON "copilot_source_reviews" USING btree ("organization_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_gen_sessions_org" ON "generation_sessions" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_gen_sessions_status" ON "generation_sessions" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_gen_sessions_cycle" ON "generation_sessions" USING btree ("cycle_id");
CREATE INDEX IF NOT EXISTS "health_check_config_org_id_idx" ON "health_check_config" USING btree ("org_id");
CREATE INDEX IF NOT EXISTS "health_check_instance_id_idx" ON "health_check_results" USING btree ("instance_id");
CREATE INDEX IF NOT EXISTS "health_check_timestamp_idx" ON "health_check_results" USING btree ("check_timestamp");
CREATE INDEX IF NOT EXISTS "health_check_org_id_idx" ON "health_check_results" USING btree ("org_id");
CREATE INDEX IF NOT EXISTS "idx_maa_run" ON "mission_agent_assignments" USING btree ("mission_run_id");
CREATE INDEX IF NOT EXISTS "idx_maa_agent" ON "mission_agent_assignments" USING btree ("agent_deployment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_maa_run_agent" ON "mission_agent_assignments" USING btree ("mission_run_id","agent_deployment_id");
CREATE INDEX IF NOT EXISTS "idx_ps_agent" ON "performance_snapshots" USING btree ("agent_deployment_id");
CREATE INDEX IF NOT EXISTS "idx_ps_run" ON "performance_snapshots" USING btree ("mission_run_id");
CREATE INDEX IF NOT EXISTS "idx_ps_captured" ON "performance_snapshots" USING btree ("captured_at");
CREATE INDEX IF NOT EXISTS "idx_policy_violations_org" ON "policy_violations" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_policy_violations_occurred_at" ON "policy_violations" USING btree ("occurred_at");
CREATE INDEX IF NOT EXISTS "idx_policy_violations_check_type" ON "policy_violations" USING btree ("check_type");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_accounts_org_key_idx" ON "sales_accounts" USING btree ("organization_id","account_key");
CREATE INDEX IF NOT EXISTS "sales_accounts_org_name_idx" ON "sales_accounts" USING btree ("organization_id","name");
CREATE INDEX IF NOT EXISTS "sales_accounts_external_crm_idx" ON "sales_accounts" USING btree ("external_crm_id");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_activities_org_key_idx" ON "sales_activities" USING btree ("organization_id","activity_key");
CREATE INDEX IF NOT EXISTS "sales_activities_opportunity_idx" ON "sales_activities" USING btree ("opportunity_id");
CREATE INDEX IF NOT EXISTS "sales_activities_occurred_at_idx" ON "sales_activities" USING btree ("organization_id","occurred_at");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_contacts_org_key_idx" ON "sales_contacts" USING btree ("organization_id","contact_key");
CREATE INDEX IF NOT EXISTS "sales_contacts_account_idx" ON "sales_contacts" USING btree ("account_id");
CREATE INDEX IF NOT EXISTS "sales_contacts_email_idx" ON "sales_contacts" USING btree ("organization_id","email");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_forecasts_org_key_idx" ON "sales_forecasts" USING btree ("organization_id","forecast_key");
CREATE INDEX IF NOT EXISTS "sales_forecasts_period_idx" ON "sales_forecasts" USING btree ("organization_id","period");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_leads_org_key_idx" ON "sales_leads" USING btree ("organization_id","lead_key");
CREATE INDEX IF NOT EXISTS "sales_leads_prospect_lead_idx" ON "sales_leads" USING btree ("prospect_lead_id");
CREATE INDEX IF NOT EXISTS "sales_leads_org_status_idx" ON "sales_leads" USING btree ("organization_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_opportunities_org_key_idx" ON "sales_opportunities" USING btree ("organization_id","opportunity_key");
CREATE INDEX IF NOT EXISTS "sales_opportunities_account_idx" ON "sales_opportunities" USING btree ("account_id");
CREATE INDEX IF NOT EXISTS "sales_opportunities_org_stage_idx" ON "sales_opportunities" USING btree ("organization_id","stage");
CREATE INDEX IF NOT EXISTS "sales_opportunities_owner_idx" ON "sales_opportunities" USING btree ("organization_id","owner_rep");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_opportunity_windows_org_key_idx" ON "sales_opportunity_windows" USING btree ("organization_id","window_key");
CREATE INDEX IF NOT EXISTS "sales_opportunity_windows_opportunity_idx" ON "sales_opportunity_windows" USING btree ("opportunity_id");
CREATE INDEX IF NOT EXISTS "sales_opportunity_windows_status_deadline_idx" ON "sales_opportunity_windows" USING btree ("status","next_gate_deadline");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_quotas_org_key_idx" ON "sales_quotas" USING btree ("organization_id","quota_key");
CREATE INDEX IF NOT EXISTS "sales_quotas_owner_period_idx" ON "sales_quotas" USING btree ("organization_id","owner_rep","period");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_recommendations_domain_org_key_idx" ON "sales_recommendations_domain" USING btree ("organization_id","recommendation_key");
CREATE INDEX IF NOT EXISTS "sales_recommendations_domain_opportunity_idx" ON "sales_recommendations_domain" USING btree ("opportunity_id");
CREATE INDEX IF NOT EXISTS "sales_recommendations_domain_status_idx" ON "sales_recommendations_domain" USING btree ("organization_id","status");
CREATE INDEX IF NOT EXISTS "sales_stage_history_opportunity_idx" ON "sales_stage_history" USING btree ("opportunity_id");
CREATE INDEX IF NOT EXISTS "sales_stage_history_changed_at_idx" ON "sales_stage_history" USING btree ("organization_id","changed_at");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_window_snapshots_org_key_idx" ON "sales_window_snapshots" USING btree ("organization_id","snapshot_key");
CREATE INDEX IF NOT EXISTS "sales_window_snapshots_window_idx" ON "sales_window_snapshots" USING btree ("window_id");
CREATE INDEX IF NOT EXISTS "sales_window_snapshots_taken_at_idx" ON "sales_window_snapshots" USING btree ("organization_id","taken_at");
