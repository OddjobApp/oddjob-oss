-- 0126_computer_use_skills
--
-- Recordings and skills for computer use.
--
-- When a computer-use task hands control to a person (yield_to_user) and they finish the
-- step in the desktop's browser, Oddjob records what they did over CDP: page-level steps
-- (click the "Search" button, fill the "Email" field), never the values typed into
-- password or one-time-code fields. A recording becomes a draft skill: replayable steps,
-- named inputs, secret slots and a written procedure. Only a skill someone approves is
-- matched against new tasks and replayed, with the Gemini loop taking over from the first
-- step that no longer matches.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "computer_use_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"task_id" uuid,
	"status" text DEFAULT 'recording' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"start_url" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "computer_use_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"site" text,
	"goal_example" text,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"procedure" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"risk_class" text DEFAULT 'medium' NOT NULL,
	"source_recording_id" uuid,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "computer_use_recordings" ADD CONSTRAINT "computer_use_recordings_organization_id_orgs_org_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "computer_use_recordings" ADD CONSTRAINT "computer_use_recordings_task_id_fk"
		FOREIGN KEY ("task_id") REFERENCES "public"."trycua_computer_use_tasks"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "computer_use_skills" ADD CONSTRAINT "computer_use_skills_organization_id_orgs_org_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "computer_use_skills" ADD CONSTRAINT "computer_use_skills_source_recording_id_fk"
		FOREIGN KEY ("source_recording_id") REFERENCES "public"."computer_use_recordings"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_computer_use_recordings_org_time" ON "computer_use_recordings" USING btree ("organization_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_computer_use_skills_org_status_site" ON "computer_use_skills" USING btree ("organization_id","status","site");
