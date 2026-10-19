-- 0114_hil_form_project
--
-- Form names are unique within a Project Space, as dataset names and knowledge
-- document titles are (0007). project_resources records which project a form
-- belongs to, but Postgres cannot enforce uniqueness across that junction, so the
-- project is on the form row too, kept in step by the project service.
--
-- An organization's default project, the home of every unassigned form, does not
-- namespace names: its forms keep project_id NULL, so forms that already share a
-- name in an organization do not collide.
--
-- Idempotent.

ALTER TABLE "hil_forms" ADD COLUMN IF NOT EXISTS "project_id" integer;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "hil_forms" ADD CONSTRAINT "hil_forms_project_id_projects_id_fk"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hil_forms_project_name_unique" ON "hil_forms" ("project_id", "name")
    WHERE "kind" = 'template' AND "is_archived" = false AND "project_id" IS NOT NULL;
