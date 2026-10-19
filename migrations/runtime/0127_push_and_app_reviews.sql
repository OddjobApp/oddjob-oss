-- 0127_push_and_app_reviews
--
-- Web push. Until now every "notification" outside the browser tab was a placeholder:
-- the approval-notification worker logged an email and a Slack message it never sent,
-- and the in-page browser notifications only fire while an Oddjob tab is open. A push
-- subscription is one browser on one device; `endpoint` is unique so re-subscribing the
-- same browser (or a different person signing in on it) updates the row.
--
-- push_deliveries is the claim ledger: a sender inserts (source, source_id, user_id)
-- and only sends when the insert wins, so the approval sweep can run in more than one
-- process without double-pushing.
--
-- App reviews. One rating per person per marketplace listing, 1-5, on apps.id so every
-- installing org's opinion lands on the same card.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" integer,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organization_id_orgs_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_deliveries" (
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_deliveries_source_source_id_user_id_pk" PRIMARY KEY("source","source_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "app_reviews" ADD CONSTRAINT "app_reviews_app_id_apps_id_fk"
		FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "app_reviews" ADD CONSTRAINT "app_reviews_organization_id_orgs_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "public"."orgs"("org_id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "app_reviews" ADD CONSTRAINT "app_reviews_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_reviews_app_user_unq" ON "app_reviews" ("app_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_reviews_app_idx" ON "app_reviews" ("app_id");
