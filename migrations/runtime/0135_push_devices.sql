-- 0135_push_devices
--
-- Phone push. push_subscriptions (0127) holds browsers, reached through web push and
-- VAPID; the Android app is reached through Firebase Cloud Messaging instead, by a
-- registration token. One row per app install: the token is unique, so the same phone
-- re-registering (or a different person signing in on it) updates the row.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "push_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" integer,
	"platform" text NOT NULL,
	"token" text NOT NULL,
	"app_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_organization_id_orgs_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_devices_user_idx" ON "push_devices" USING btree ("user_id");
