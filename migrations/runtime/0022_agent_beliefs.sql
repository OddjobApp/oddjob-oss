-- Agent beliefs and theory-of-mind calibration.
--
-- agent_knowledge_graph_entries already stores confidence-weighted claims, but
-- it answers "what have I learned". A belief is different: a POSITION an agent
-- holds that could turn out to be wrong, which must be revisable and must record
-- what changed it. Conflating the two loses the revision history that makes a
-- belief meaningful.
--
-- agent_belief_predictions is what stops this being theatre. A model asked what
-- another agent believes will always produce fluent, plausible text; the only
-- way to know whether the model is any good is to predict BEFORE observing and
-- score afterwards. Crew turns are sequential, so the ground truth arrives for
-- free — the classic false-belief test, operationalised.

-- ============================================================================
-- 1. AGENT BELIEFS
-- ============================================================================

CREATE TABLE "agent_beliefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"project_id" integer,
	"agent_card_id" integer NOT NULL,
	"proposition" text NOT NULL,
	"confidence" integer DEFAULT 50 NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	-- Turn ids / knowledge entries the position rests on.
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_session_id" integer,
	"source_round" integer,
	-- Set when a later belief replaces this one, so the trail is inspectable.
	"superseded_by" integer,
	"revision_reason" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_beliefs_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 100),
	CONSTRAINT "agent_beliefs_status_check" CHECK ("status" IN ('held', 'revised', 'abandoned'))
);
--> statement-breakpoint
ALTER TABLE "agent_beliefs" ADD CONSTRAINT "agent_beliefs_agent_card_id_agent_cards_id_fk" FOREIGN KEY ("agent_card_id") REFERENCES "public"."agent_cards"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_beliefs" ADD CONSTRAINT "agent_beliefs_superseded_by_agent_beliefs_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."agent_beliefs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_beliefs" ADD CONSTRAINT "agent_beliefs_source_session_id_crew_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_agent_beliefs_agent" ON "agent_beliefs" USING btree ("agent_card_id","status");
--> statement-breakpoint
CREATE INDEX "idx_agent_beliefs_org" ON "agent_beliefs" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_agent_beliefs_project" ON "agent_beliefs" USING btree ("project_id");

-- ============================================================================
-- 2. BELIEF PREDICTIONS (theory-of-mind calibration)
-- ============================================================================
-- accuracy_score is null until the subject has actually spoken and the
-- prediction has been scored against what they said.
--> statement-breakpoint
CREATE TABLE "agent_belief_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"predictor_agent_card_id" integer NOT NULL,
	"subject_agent_card_id" integer NOT NULL,
	"predicted_position" text NOT NULL,
	"observed_turn_id" integer,
	"accuracy_score" integer,
	"scored_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "agent_belief_predictions_accuracy_check" CHECK ("accuracy_score" IS NULL OR ("accuracy_score" >= 0 AND "accuracy_score" <= 100))
);
--> statement-breakpoint
ALTER TABLE "agent_belief_predictions" ADD CONSTRAINT "abp_session_id_crew_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_belief_predictions" ADD CONSTRAINT "abp_predictor_agent_cards_id_fk" FOREIGN KEY ("predictor_agent_card_id") REFERENCES "public"."agent_cards"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_belief_predictions" ADD CONSTRAINT "abp_subject_agent_cards_id_fk" FOREIGN KEY ("subject_agent_card_id") REFERENCES "public"."agent_cards"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_belief_predictions" ADD CONSTRAINT "abp_observed_turn_id_crew_turns_id_fk" FOREIGN KEY ("observed_turn_id") REFERENCES "public"."crew_turns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_abp_predictor" ON "agent_belief_predictions" USING btree ("predictor_agent_card_id");
--> statement-breakpoint
CREATE INDEX "idx_abp_session" ON "agent_belief_predictions" USING btree ("session_id","round");
--> statement-breakpoint
CREATE INDEX "idx_abp_unscored" ON "agent_belief_predictions" USING btree ("session_id") WHERE "accuracy_score" IS NULL;
