-- 0130_omnichannel_identities
--
-- Omnichannel identity bindings. Maps external messaging channels (Twilio SMS,
-- WhatsApp, Telegram) to verified Oddjob user accounts and organization scopes.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "omnichannel_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"channel_type" text NOT NULL,
	"channel_identifier" text NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verification_code" text,
	"verification_expires_at" timestamp with time zone,
	"default_project_id" integer,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "omnichannel_identities" ADD CONSTRAINT "omnichannel_identities_organization_id_orgs_org_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "omnichannel_identities" ADD CONSTRAINT "omnichannel_identities_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "omnichannel_identities" ADD CONSTRAINT "omnichannel_identities_default_project_id_projects_id_fk"
		FOREIGN KEY ("default_project_id") REFERENCES "public"."projects"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unq_org_channel_identifier" ON "omnichannel_identities" ("organization_id", "channel_type", "channel_identifier");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_omnichannel_lookup" ON "omnichannel_identities" ("channel_identifier", "channel_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_omnichannel_user" ON "omnichannel_identities" ("user_id", "organization_id");
