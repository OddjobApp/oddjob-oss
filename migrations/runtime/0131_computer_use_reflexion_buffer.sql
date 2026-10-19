-- 0131_computer_use_reflexion_buffer
--
-- Reflexion self-healing buffer for computer-use skills. Stores episodic critiques,
-- DOM failure signatures, and proposed remediations for autonomous replay recovery.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "computer_use_reflexion_buffer" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"skill_id" uuid,
	"step_index" integer NOT NULL,
	"site" text NOT NULL,
	"failure_category" text NOT NULL,
	"dom_failure_signature" text NOT NULL,
	"verbal_critique" text NOT NULL,
	"proposed_remediation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trial_count" integer DEFAULT 1 NOT NULL,
	"succeeded_on_next_trial" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "computer_use_reflexion_buffer" ADD CONSTRAINT "computer_use_reflexion_buffer_organization_id_orgs_org_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "computer_use_reflexion_buffer" ADD CONSTRAINT "computer_use_reflexion_buffer_skill_id_computer_use_skills_id_fk"
		FOREIGN KEY ("skill_id") REFERENCES "public"."computer_use_skills"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reflexion_skill_step" ON "computer_use_reflexion_buffer" ("skill_id", "step_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reflexion_site_sig" ON "computer_use_reflexion_buffer" ("site", "dom_failure_signature");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reflexion_org_site" ON "computer_use_reflexion_buffer" ("organization_id", "site");
