ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "company_size" text;
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "industry" text;
