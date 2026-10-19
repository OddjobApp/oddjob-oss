-- CREW Group Chat
--
-- A CREW session is a multi-agent discussion room. Several agent cards are added
-- to one conversation, agents respond to EACH OTHER based on the topic under
-- discussion, the user participates as a first-class speaker, and a supervisor
-- ("manager") sits alongside the transcript to critique contributions, refine
-- consensus, summarise, take notes, create plans and introduce intents.
--
-- Design notes:
--  * agent_cards gains the Soul layer (OCEAN traits + archetype + Legend) so a
--    crew member speaks in its own voice. These mirror the columns already on
--    agent_deployments, but agent cards are the unit the router selects and most
--    cards have no deployment at all (3 deployments vs 21 cards), so the traits
--    have to live here to be usable.
--  * Defaults are deliberately NOT flat 0.5 at the column level — a uniform
--    profile makes SoulService.generateSoulPrompt() emit no steering lines at
--    all (its thresholds are o>0.8, c>0.8, e<0.3, a>0.7, n>0.6) and every agent
--    would sound identical. The backfill script assigns differentiated profiles.
--  * crew_turns is the transcript. in_reply_to_turn_id is what makes
--    agent-to-agent exchange representable rather than a fan of replies to the
--    user.

-- ============================================================================
-- 1. AGENT CARD SOUL LAYER (personality from Legend + OCEAN)
-- ============================================================================

ALTER TABLE "agent_cards"
  ADD COLUMN IF NOT EXISTS "ocean_traits" jsonb DEFAULT '{"o":0.5,"c":0.5,"e":0.5,"a":0.5,"n":0.5}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_cards"
  ADD COLUMN IF NOT EXISTS "soul_archetype" text;
--> statement-breakpoint
ALTER TABLE "agent_cards"
  ADD COLUMN IF NOT EXISTS "legend" text;

-- ============================================================================
-- 2. CREW SESSIONS (a discussion room)
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "crew_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"session_key" text NOT NULL,
	"title" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "crew_sessions_status_check" CHECK ("status" IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crew_sessions_org_key_unique" ON "crew_sessions" USING btree ("organization_id","session_key");
--> statement-breakpoint
CREATE INDEX "idx_crew_sessions_org" ON "crew_sessions" USING btree ("organization_id");

-- ============================================================================
-- 3. CREW MEMBERS (which agent cards are in the room)
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "crew_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"agent_card_id" integer NOT NULL,
	"joined_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_session_id_crew_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_agent_card_id_agent_cards_id_fk" FOREIGN KEY ("agent_card_id") REFERENCES "public"."agent_cards"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "crew_members_session_card_unique" ON "crew_members" USING btree ("session_id","agent_card_id");

-- ============================================================================
-- 4. CREW TURNS (the transcript — user, agents, supervisor)
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "crew_turns" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"speaker_type" text NOT NULL,
	"agent_card_id" integer,
	"speaker_name" text NOT NULL,
	"content" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"in_reply_to_turn_id" integer,
	"topic" text,
	"intent" text,
	"resolved_model_id" integer,
	"latency_ms" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "crew_turns_speaker_type_check" CHECK ("speaker_type" IN ('user', 'agent', 'supervisor'))
);
--> statement-breakpoint
ALTER TABLE "crew_turns" ADD CONSTRAINT "crew_turns_session_id_crew_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crew_turns" ADD CONSTRAINT "crew_turns_agent_card_id_agent_cards_id_fk" FOREIGN KEY ("agent_card_id") REFERENCES "public"."agent_cards"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "crew_turns" ADD CONSTRAINT "crew_turns_in_reply_to_turn_id_crew_turns_id_fk" FOREIGN KEY ("in_reply_to_turn_id") REFERENCES "public"."crew_turns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_crew_turns_session" ON "crew_turns" USING btree ("session_id","id");
--> statement-breakpoint
CREATE INDEX "idx_crew_turns_org" ON "crew_turns" USING btree ("organization_id");

-- ============================================================================
-- 5. SUPERVISOR NOTES (critique, consensus, summaries, running notes)
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "supervisor_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"note_type" text NOT NULL,
	"content" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"target_turn_id" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "supervisor_notes_type_check" CHECK ("note_type" IN ('note', 'critique', 'consensus', 'summary', 'intent'))
);
--> statement-breakpoint
ALTER TABLE "supervisor_notes" ADD CONSTRAINT "supervisor_notes_session_id_crew_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supervisor_notes" ADD CONSTRAINT "supervisor_notes_target_turn_id_crew_turns_id_fk" FOREIGN KEY ("target_turn_id") REFERENCES "public"."crew_turns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_supervisor_notes_session" ON "supervisor_notes" USING btree ("session_id","id");
--> statement-breakpoint
CREATE INDEX "idx_supervisor_notes_type" ON "supervisor_notes" USING btree ("session_id","note_type");

-- ============================================================================
-- 6. CREW PLANS (structured plans the supervisor creates)
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "crew_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"title" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "crew_plans_status_check" CHECK ("status" IN ('proposed', 'accepted', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "crew_plans" ADD CONSTRAINT "crew_plans_session_id_crew_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_crew_plans_session" ON "crew_plans" USING btree ("session_id","id");
