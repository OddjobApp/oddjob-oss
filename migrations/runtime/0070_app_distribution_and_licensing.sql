-- Distribution class for apps and blueprints, and licensing for a deployment.
--
-- The three classes the product needs — standard built-in, org's own custom, and
-- listed for demo/purchase — are not derivable from the flags that exist. `is_system`
-- identifies a built-in cleanly, but `is_public` does NOT mean "for sale": Org Forge
-- stamps it on every app it installs (org-forge.service.ts), which is why 19 of the 20
-- org-authored apps carry it while not one app is priced. An explicit column is the
-- only honest way to say which class a row is in, and money makes guessing expensive.
--
-- NOTE: unrelated to the legacy root-level migrations/0070_capability_sync_state.sql.
-- The two directories carry independent sequences and the runtime migrator reads only
-- this one; the shared number is a coincidence of both reaching 70.

ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "distribution" varchar(20) DEFAULT 'custom' NOT NULL;--> statement-breakpoint

-- Backfill from the one flag that does mean what it says. Everything else is an org's
-- own app; nothing becomes 'listed' until something can actually be listed.
UPDATE "apps" SET "distribution" = 'standard' WHERE "is_system" = true AND "distribution" <> 'standard';--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "apps" ADD CONSTRAINT "apps_distribution_check"
        CHECK ("distribution" IN ('standard', 'custom', 'listed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- A built-in IS standard, so refuse the mismatch rather than let a new writer default
-- its way to 'custom' and quietly misfile a platform app. The 18 registration scripts
-- that create built-ins now set it explicitly; this is what makes the 19th fail loudly.
DO $$ BEGIN
    ALTER TABLE "apps" ADD CONSTRAINT "apps_system_is_standard_check"
        CHECK (NOT "is_system" OR "distribution" = 'standard');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Blueprints get the same three classes. Every existing row is a platform-provided
-- template, and the table has no ownership column at all, so a blueprint someone
-- authored to sell has nowhere to live until developer_org_id exists.
ALTER TABLE "blueprints" ADD COLUMN IF NOT EXISTS "distribution" varchar(20) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "blueprints" ADD COLUMN IF NOT EXISTS "developer_org_id" integer;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_developer_org_id_orgs_org_id_fk"
        FOREIGN KEY ("developer_org_id") REFERENCES "orgs"("org_id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_distribution_check"
        CHECK ("distribution" IN ('standard', 'custom', 'listed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- A demo is not a fourth kind of app: it is an installation with a trial budget and
-- an expiry. budget_limit_usd and current_spend_usd already live on this table, so
-- the plan and the date are all that were missing. Existing rows are 'internal' —
-- an org installing into itself, which is every deployment that predates a market.
ALTER TABLE "app_deployments" ADD COLUMN IF NOT EXISTS "plan" varchar(20) DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_deployments" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "app_deployments" ADD CONSTRAINT "app_deployments_plan_check"
        CHECK ("plan" IN ('internal', 'trial', 'purchased'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- A trial that never expires is a giveaway; a purchase does not expire. Enforce the
-- pairing rather than leaving it to whichever service happens to write the row.
DO $$ BEGIN
    ALTER TABLE "app_deployments" ADD CONSTRAINT "app_deployments_trial_expiry_check"
        CHECK ("plan" <> 'trial' OR "expires_at" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "apps_distribution_idx" ON "apps" USING btree ("distribution");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_deployments_plan_idx" ON "app_deployments" USING btree ("plan");
