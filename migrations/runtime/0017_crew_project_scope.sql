-- CREW Project Space scoping
--
-- Crew rooms were org-scoped only: a discussion had no idea which Project Space
-- it belonged to. That was tolerable while a discussion was ephemeral, but the
-- learning loop (0016) files conclusions into agent knowledge graphs and recalls
-- them in later discussions — so without scoping, a conclusion reached inside a
-- private project could surface in a discussion in a different project.
--
-- project_id is nullable: rooms created before this migration have no project,
-- and recall treats an unscoped entry as visible only to unscoped discussions.
--
-- Idempotent: safe to re-run.

ALTER TABLE "crew_sessions"
  ADD COLUMN IF NOT EXISTS "project_id" integer;
--> statement-breakpoint
ALTER TABLE "crew_sessions"
  ADD CONSTRAINT "crew_sessions_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crew_sessions_project" ON "crew_sessions" USING btree ("project_id");

-- Issues and observations inherit the room's project, denormalised so an
-- org-wide issue list can filter by project without joining back through the
-- session on every query.
--> statement-breakpoint
ALTER TABLE "crew_issues"
  ADD COLUMN IF NOT EXISTS "project_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crew_issues_project" ON "crew_issues" USING btree ("project_id");
--> statement-breakpoint
ALTER TABLE "crew_intent_observations"
  ADD COLUMN IF NOT EXISTS "project_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cio_project" ON "crew_intent_observations" USING btree ("project_id");
