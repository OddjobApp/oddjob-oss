-- Theory of Mind (ToM) — per-user-per-org cognitive model tracking what users
-- KNOW, BELIEVE, EXPECT, and FEEL. Complements user_representations which
-- captures durable preferences/goals via dialectic reconciliation.
--
-- One row per (organizationId, userId). Updated in real-time by the sync
-- assessor and async extractor; decayed by the cycle-worker batch.

-- ============================================================================
-- 1. THEORY OF MIND (active cognitive state)
-- ============================================================================

CREATE TABLE "theory_of_mind" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"epistemic_states" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"beliefs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expectations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cognitive_state" jsonb DEFAULT '{"frustration":0,"confusion":0,"urgency":0,"explorationVsGoal":50,"assessedAt":null}'::jsonb NOT NULL,
	"intent_model" jsonb DEFAULT '{"literalIntent":"","inferredIntent":"","inferredConfidence":0,"diverges":false,"sessionSignals":[],"sessionId":"","updatedAt":null}'::jsonb NOT NULL,
	"knowledge_gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ocean_profile" jsonb DEFAULT '{"openness":0.5,"conscientiousness":0.5,"extraversion":0.5,"agreeableness":0.5,"neuroticism":0.5,"confidence":0,"observationCount":0,"lastCalibratedAt":null}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "theory_of_mind" ADD CONSTRAINT "theory_of_mind_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "theory_of_mind" ADD CONSTRAINT "theory_of_mind_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "theory_of_mind_user_org_unique" ON "theory_of_mind" USING btree ("organization_id","user_id");
--> statement-breakpoint
CREATE INDEX "theory_of_mind_candidates_idx" ON "theory_of_mind" USING btree ("organization_id","updated_at");

-- ============================================================================
-- 2. TOM ARCHIVED ENTRIES (decayed entries moved here for historical analysis)
-- ============================================================================
--> statement-breakpoint
CREATE TABLE "tom_archived_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"dimension" text NOT NULL,
	"entry_data" jsonb NOT NULL,
	"original_confidence" integer NOT NULL,
	"effective_confidence_at_archive" real NOT NULL,
	"archived_at" timestamp DEFAULT now() NOT NULL,
	"observed_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tom_archived_entries" ADD CONSTRAINT "tom_archived_entries_organization_id_orgs_org_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tom_archived_entries" ADD CONSTRAINT "tom_archived_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tom_archived_org_user_idx" ON "tom_archived_entries" USING btree ("organization_id","user_id");
--> statement-breakpoint
CREATE INDEX "tom_archived_dimension_idx" ON "tom_archived_entries" USING btree ("organization_id","user_id","dimension");
--> statement-breakpoint
CREATE INDEX "tom_archived_at_idx" ON "tom_archived_entries" USING btree ("archived_at");
