CREATE TABLE IF NOT EXISTS "skill_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "skill_id" integer REFERENCES "skills"("id") ON DELETE set null,
  "skill_name" text NOT NULL,
  "skill_description" text,
  "source_url" text,
  "source_platform" text DEFAULT 'custom',
  "extracted_persona" text,
  "extracted_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "extracted_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "decision_recommendation" text,
  "compatibility_score" integer,
  "scoring_breakdown" jsonb,
  "target_agent_card_id" integer REFERENCES "agent_cards"("id") ON DELETE set null,
  "top_matches" jsonb DEFAULT '[]'::jsonb,
  "security_report" jsonb,
  "risk_level" text DEFAULT 'medium',
  "reviewer_id" text,
  "review_notes" text,
  "submitted_by" text,
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_skill_reviews_org" ON "skill_reviews" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_skill_reviews_status" ON "skill_reviews" ("organization_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_skill_reviews_agent" ON "skill_reviews" ("target_agent_card_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_augmentations" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "skill_id" integer REFERENCES "skills"("id") ON DELETE set null,
  "agent_card_id" integer NOT NULL REFERENCES "agent_cards"("id") ON DELETE cascade,
  "review_id" integer REFERENCES "skill_reviews"("id") ON DELETE set null,
  "capabilities_added" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tools_added" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "topic_affinities_added" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "intent_affinities_added" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rollback_snapshot" jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "applied_by" text,
  "applied_at" timestamp DEFAULT now() NOT NULL,
  "rolled_back_by" text,
  "rolled_back_at" timestamp
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_skill_aug_org_agent" ON "skill_augmentations" ("organization_id", "agent_card_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_skill_aug_skill" ON "skill_augmentations" ("skill_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_review_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "review_id" integer NOT NULL REFERENCES "skill_reviews"("id") ON DELETE cascade,
  "reviewer_id" text NOT NULL,
  "assigned_by" text,
  "status" text DEFAULT 'assigned' NOT NULL,
  "due_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_skill_review_assign_org" ON "skill_review_assignments" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_skill_review_assign_rev" ON "skill_review_assignments" ("review_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE cascade,
  "skill_id" integer NOT NULL REFERENCES "skills"("id") ON DELETE cascade,
  "target_agent_card_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "assignment_type" text DEFAULT 'single_agent' NOT NULL,
  "assigned_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_skill_assignments_org" ON "skill_assignments" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_skill_assignments_skill" ON "skill_assignments" ("skill_id");
