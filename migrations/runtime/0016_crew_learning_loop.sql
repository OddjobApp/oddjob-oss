-- CREW learning loop
--
-- Turns discussions into operational output instead of leaving them as one-off
-- transcripts:
--
--   crew_issues              unresolved disagreement, raised as something actionable
--   crew_intent_observations what the keyword classifier guessed vs. what the
--                            discussion actually revealed the user wanted
--
-- Knowledge write-back needs no table of its own — it reuses the existing
-- agent_knowledge_graph_entries store via AgentMemoryAcrossMissionsService.

-- ============================================================================
-- 1. CREW ISSUES
-- ============================================================================
-- A low consensus score with a supervisor critique is a real signal: the crew
-- looked at something and could not agree. That is worth surfacing rather than
-- burying in a transcript.

CREATE TABLE "crew_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"consensus_level" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"source_turn_id" integer,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	CONSTRAINT "crew_issues_severity_check" CHECK ("severity" IN ('low', 'medium', 'high')),
	CONSTRAINT "crew_issues_status_check" CHECK ("status" IN ('open', 'acknowledged', 'resolved', 'dismissed')),
	CONSTRAINT "crew_issues_consensus_check" CHECK ("consensus_level" IS NULL OR ("consensus_level" >= 0 AND "consensus_level" <= 100))
);
--> statement-breakpoint
ALTER TABLE "crew_issues" ADD CONSTRAINT "crew_issues_session_id_crew_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crew_issues" ADD CONSTRAINT "crew_issues_source_turn_id_crew_turns_id_fk" FOREIGN KEY ("source_turn_id") REFERENCES "public"."crew_turns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_crew_issues_org_status" ON "crew_issues" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX "idx_crew_issues_session" ON "crew_issues" USING btree ("session_id","id");

-- ============================================================================
-- 2. CREW INTENT OBSERVATIONS
-- ============================================================================
-- The intent router classifies on keywords, which is why a substantive question
-- can still land as topic=General/intent=Chat. A round later the crew has
-- surfaced what was actually wanted. Recording both sides gives a labelled
-- corpus to measure routing against.
--
-- Deliberately a separate table rather than columns on intent_classification_logs:
-- that table has an established contract and test suite, and these rows are
-- observations rather than routing decisions.
--> statement-breakpoint
CREATE TABLE "crew_intent_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"prompt_hash" text NOT NULL,
	"prompt_excerpt" text,
	"classified_topic" text NOT NULL,
	"classified_topic_confidence" real,
	"classified_intent" text NOT NULL,
	"classified_intent_confidence" real,
	"discovered_intent" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "crew_intent_observations" ADD CONSTRAINT "crew_intent_observations_session_id_crew_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_cio_org" ON "crew_intent_observations" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_cio_session" ON "crew_intent_observations" USING btree ("session_id","id");
--> statement-breakpoint
CREATE INDEX "idx_cio_hash" ON "crew_intent_observations" USING btree ("prompt_hash");

-- ============================================================================
-- 3. CREW HAND RAISES
-- ============================================================================
-- Only a few members speak per round (each speaker is a sequential model call).
-- The rest are not necessarily irrelevant — an agent may hold directly relevant
-- experience and simply not have been picked. A hand raise is that signal.
--
-- Deliberately computed WITHOUT a model call: affinity to the classified
-- topic/intent, plus how many entries the agent's own knowledge graph returns
-- for the subject. Asking every silent agent "do you have something to add?"
-- would cost as much as just letting them all speak.
--> statement-breakpoint
CREATE TABLE "crew_hand_raises" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"agent_card_id" integer NOT NULL,
	"reason" text NOT NULL,
	"affinity_score" integer DEFAULT 0 NOT NULL,
	"memory_hits" integer DEFAULT 0 NOT NULL,
	"called_on" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "crew_hand_raises" ADD CONSTRAINT "crew_hand_raises_session_id_crew_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crew_hand_raises" ADD CONSTRAINT "crew_hand_raises_agent_card_id_agent_cards_id_fk" FOREIGN KEY ("agent_card_id") REFERENCES "public"."agent_cards"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "crew_hand_raises_round_agent_unique" ON "crew_hand_raises" USING btree ("session_id","round","agent_card_id");
--> statement-breakpoint
CREATE INDEX "idx_chr_session" ON "crew_hand_raises" USING btree ("session_id","id");
