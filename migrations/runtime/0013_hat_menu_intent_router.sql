-- Hat Menu Intent Router & Signal Intelligence Tables
--
-- Creates the following tables for the Hat Menu Intent Router feature:
-- 1. agent_cards - Specialized agent cards with model bindings for intent-based routing
-- 2. intent_classification_logs - Logs for intent classification decisions
-- 3. signal_feeds - External signal feed configurations
-- 4. event_primitives - Normalized event primitives extracted from signal feeds
-- 5. causal_graph_links - Causal relationships between events and business entities
-- 6. autonomous_action_policies - Policies for autonomous action triggering
-- 7. state_transition_events - World model state transition events
-- 8. autonomous_action_logs - Logs for autonomous action executions

-- ============================================================================
-- 1. AGENT CARDS (references llm_providers, llm_models)
-- ============================================================================

CREATE TABLE "agent_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500) NOT NULL,
	"persona_type" text NOT NULL,
	"model_binding_provider_id" integer,
	"model_binding_model_id" integer,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topic_affinities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intent_affinities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_cards" ADD CONSTRAINT "agent_cards_model_binding_provider_id_llm_providers_id_fk" FOREIGN KEY ("model_binding_provider_id") REFERENCES "public"."llm_providers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_cards" ADD CONSTRAINT "agent_cards_model_binding_model_id_llm_models_id_fk" FOREIGN KEY ("model_binding_model_id") REFERENCES "public"."llm_models"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_agent_cards_org" ON "agent_cards" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_agent_cards_enabled" ON "agent_cards" USING btree ("organization_id","enabled");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_cards_org_lower_name_unique" ON "agent_cards" USING btree ("organization_id",lower("name"));

-- ============================================================================
-- 2. INTENT CLASSIFICATION LOGS (references agent_cards, llm_models)
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "intent_classification_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"session_id" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"topic" text NOT NULL,
	"topic_confidence" real NOT NULL,
	"intent" text NOT NULL,
	"intent_confidence" real NOT NULL,
	"combined_confidence" real NOT NULL,
	"selected_agent_card_id" integer,
	"resolved_model_id" integer,
	"latency_ms" integer NOT NULL,
	"was_cached" boolean DEFAULT false,
	"was_override" boolean DEFAULT false,
	"override_agent_card_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "intent_classification_logs" ADD CONSTRAINT "intent_classification_logs_selected_agent_card_id_agent_cards_id_fk" FOREIGN KEY ("selected_agent_card_id") REFERENCES "public"."agent_cards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intent_classification_logs" ADD CONSTRAINT "intent_classification_logs_resolved_model_id_llm_models_id_fk" FOREIGN KEY ("resolved_model_id") REFERENCES "public"."llm_models"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_icl_org_session" ON "intent_classification_logs" USING btree ("organization_id","session_id");
--> statement-breakpoint
CREATE INDEX "idx_icl_created" ON "intent_classification_logs" USING btree ("created_at");

-- ============================================================================
-- 3. SIGNAL FEEDS
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "signal_feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"url" text NOT NULL,
	"auth_credentials" jsonb,
	"polling_interval_seconds" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_poll_at" timestamp,
	"last_success_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "signal_feeds_polling_interval_check" CHECK ("polling_interval_seconds" >= 30 AND "polling_interval_seconds" <= 86400)
);
--> statement-breakpoint
CREATE INDEX "idx_signal_feeds_org" ON "signal_feeds" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_signal_feeds_status" ON "signal_feeds" USING btree ("organization_id","status");

-- ============================================================================
-- 4. EVENT PRIMITIVES
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "event_primitives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"source_entry_id" text NOT NULL,
	"event_type" text NOT NULL,
	"target_sector" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"severity" text NOT NULL,
	"source_url" text NOT NULL,
	"extraction_timestamp" timestamp NOT NULL,
	"confidence_score" real NOT NULL,
	"raw_text" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "event_primitives_confidence_check" CHECK ("confidence_score" >= 0.0 AND "confidence_score" <= 1.0),
	CONSTRAINT "event_primitives_severity_check" CHECK ("severity" IN ('Low', 'Medium', 'High', 'Critical'))
);
--> statement-breakpoint
CREATE INDEX "idx_event_primitives_org" ON "event_primitives" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_event_primitives_severity" ON "event_primitives" USING btree ("severity");
--> statement-breakpoint
CREATE INDEX "idx_event_primitives_sector" ON "event_primitives" USING btree ("target_sector");
--> statement-breakpoint
CREATE INDEX "idx_event_primitives_jurisdiction" ON "event_primitives" USING btree ("jurisdiction");
--> statement-breakpoint
CREATE INDEX "idx_event_primitives_confidence" ON "event_primitives" USING btree ("confidence_score");
--> statement-breakpoint
CREATE INDEX "idx_event_primitives_hash" ON "event_primitives" USING btree ("content_hash");

-- ============================================================================
-- 5. CAUSAL GRAPH LINKS (references event_primitives)
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "causal_graph_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"event_primitive_id" uuid NOT NULL,
	"target_entity_type" text NOT NULL,
	"target_entity_id" text NOT NULL,
	"impact_horizon_min_days" integer NOT NULL,
	"impact_horizon_max_days" integer NOT NULL,
	"impact_confidence" integer NOT NULL,
	"blast_radius" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "causal_graph_links_horizon_check" CHECK ("impact_horizon_min_days" <= "impact_horizon_max_days"),
	CONSTRAINT "causal_graph_links_confidence_check" CHECK ("impact_confidence" >= 0 AND "impact_confidence" <= 100),
	CONSTRAINT "causal_graph_links_depth_check" CHECK ("depth" >= 1 AND "depth" <= 3)
);
--> statement-breakpoint
ALTER TABLE "causal_graph_links" ADD CONSTRAINT "causal_graph_links_event_primitive_id_event_primitives_id_fk" FOREIGN KEY ("event_primitive_id") REFERENCES "public"."event_primitives"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_causal_graph_links_event" ON "causal_graph_links" USING btree ("event_primitive_id");
--> statement-breakpoint
CREATE INDEX "idx_causal_graph_links_entity" ON "causal_graph_links" USING btree ("target_entity_type","target_entity_id");
--> statement-breakpoint
CREATE INDEX "idx_causal_graph_links_org" ON "causal_graph_links" USING btree ("organization_id");

-- ============================================================================
-- 6. AUTONOMOUS ACTION POLICIES
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "autonomous_action_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"trigger_condition" jsonb NOT NULL,
	"action_type" text NOT NULL,
	"approval_gate" text DEFAULT 'require_human_approval' NOT NULL,
	"effective_approval_gate" text DEFAULT 'require_human_approval' NOT NULL,
	"volatility_override" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "autonomous_action_policies_action_type_check" CHECK ("action_type" IN ('spawn_cycle', 'create_rfc', 'update_compliance_check', 'modify_spatial_routing')),
	CONSTRAINT "autonomous_action_policies_approval_gate_check" CHECK ("approval_gate" IN ('auto_approve', 'require_human_approval')),
	CONSTRAINT "autonomous_action_policies_effective_gate_check" CHECK ("effective_approval_gate" IN ('auto_approve', 'require_human_approval'))
);
--> statement-breakpoint
CREATE INDEX "idx_aap_org" ON "autonomous_action_policies" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_aap_enabled" ON "autonomous_action_policies" USING btree ("organization_id","enabled");

-- ============================================================================
-- 7. STATE TRANSITION EVENTS (references event_primitives)
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "state_transition_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"event_primitive_id" uuid,
	"affected_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"impact_horizons" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"environment_variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "state_transition_events_status_check" CHECK ("status" IN ('pending', 'accepted', 'failed', 'dead_letter'))
);
--> statement-breakpoint
ALTER TABLE "state_transition_events" ADD CONSTRAINT "state_transition_events_event_primitive_id_event_primitives_id_fk" FOREIGN KEY ("event_primitive_id") REFERENCES "public"."event_primitives"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_ste_org" ON "state_transition_events" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_ste_status" ON "state_transition_events" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "idx_ste_created" ON "state_transition_events" USING btree ("created_at");

-- ============================================================================
-- 8. AUTONOMOUS ACTION LOGS (references event_primitives, autonomous_action_policies)
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "autonomous_action_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"event_primitive_id" uuid,
	"policy_id" integer,
	"action_type" text NOT NULL,
	"approval_status" text NOT NULL,
	"executed_at" timestamp,
	"outcome" text,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "autonomous_action_logs_action_type_check" CHECK ("action_type" IN ('spawn_cycle', 'create_rfc', 'update_compliance_check', 'modify_spatial_routing')),
	CONSTRAINT "autonomous_action_logs_approval_status_check" CHECK ("approval_status" IN ('auto_approved', 'pending', 'approved', 'rejected', 'escalated', 'timed_out')),
	CONSTRAINT "autonomous_action_logs_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('success', 'failure'))
);
--> statement-breakpoint
ALTER TABLE "autonomous_action_logs" ADD CONSTRAINT "autonomous_action_logs_event_primitive_id_event_primitives_id_fk" FOREIGN KEY ("event_primitive_id") REFERENCES "public"."event_primitives"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "autonomous_action_logs" ADD CONSTRAINT "autonomous_action_logs_policy_id_autonomous_action_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."autonomous_action_policies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_aal_org" ON "autonomous_action_logs" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_aal_policy" ON "autonomous_action_logs" USING btree ("policy_id");
