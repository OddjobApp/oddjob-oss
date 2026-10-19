-- Hybrid squads: the columns shared/schema/team-collaboration.ts already declares.
--
-- These were added to the Drizzle schema without a migration, which is worse than
-- a missing feature: Drizzle expands `db.select().from(teams)` into an explicit
-- column list, so every EXISTING caller (cycle-collaboration, org-forge, the
-- ontology team adapter, approval.service) started emitting SQL naming columns the
-- database does not have. This closes that gap rather than adding anything new.

ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "slug" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "squad_type" text DEFAULT 'operational' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "lead_user_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "home_h3_index" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'on_duty' NOT NULL;--> statement-breakpoint

-- Polymorphic membership. `user_id` stays for backwards compatibility and loses
-- its NOT NULL so an agent member can occupy a row; `member_id` is the forward
-- column and is backfilled from `user_id` so no row is half-populated.
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "member_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "member_id" text;--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "team_members" SET "member_id" = "user_id" WHERE "member_id" IS NULL AND "user_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "generation_sessions" ADD COLUMN IF NOT EXISTS "assigned_team_id" integer;--> statement-breakpoint

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'generation_sessions_assigned_team_id_teams_id_fk'
    ) THEN
        ALTER TABLE "generation_sessions"
            ADD CONSTRAINT "generation_sessions_assigned_team_id_teams_id_fk"
            FOREIGN KEY ("assigned_team_id") REFERENCES "teams"("id") ON DELETE SET NULL;
    END IF;
END $$;
