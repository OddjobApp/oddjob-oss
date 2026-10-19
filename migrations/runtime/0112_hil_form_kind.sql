-- 0112_hil_form_kind
--
-- hil_forms holds three different things with no column to tell them apart:
-- form templates, requests for a person's input, and stored Form Studio responses.
-- Readers guessed from status and naming. Builder templates showed in the
-- notification inbox as pending requests, runtime requests showed in the forms
-- library and in planners' prompts, and a pipeline step turned its template into
-- that run's request. `kind` records what each row is.
--
-- Idempotent: columns, constraint and index are created only if missing, and the
-- backfill only reclassifies rows still at the default, so re-applying is harmless.

ALTER TABLE "hil_forms" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'template' NOT NULL;
--> statement-breakpoint
ALTER TABLE "hil_forms" ADD COLUMN IF NOT EXISTS "request_source" text;
--> statement-breakpoint
ALTER TABLE "hil_forms" ADD COLUMN IF NOT EXISTS "template_form_id" integer;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "hil_forms" ADD CONSTRAINT "hil_forms_kind_check" CHECK ("kind" IN ('template', 'request', 'response'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hil_forms_org_kind_idx" ON "hil_forms" ("organization_id", "kind");
--> statement-breakpoint
-- Backfill from the markers each writer has always left.
UPDATE "hil_forms" SET "kind" = 'response'
    WHERE "kind" = 'template' AND "config" ? 'formStudioResponse';
--> statement-breakpoint
UPDATE "hil_forms" SET "kind" = 'request', "request_source" = 'cycle'
    WHERE "kind" = 'template' AND "config"->>'type' = 'cycle_resource_refresh';
--> statement-breakpoint
UPDATE "hil_forms" SET "kind" = 'request', "request_source" = 'app'
    WHERE "kind" = 'template' AND ("schema"->>'sourceType' = 'app' OR "name" LIKE 'App HIL:%');
--> statement-breakpoint
UPDATE "hil_forms" SET "kind" = 'request', "request_source" = 'behavioral'
    WHERE "kind" = 'template' AND "schema"->>'sourceType' = 'behavioral_intelligence';
--> statement-breakpoint
UPDATE "hil_forms" SET "kind" = 'request', "request_source" = 'agent'
    WHERE "kind" = 'template' AND "name" LIKE 'Agent HIL:%';
--> statement-breakpoint
-- A row linked to a pipeline step is that step's request, unless it is an Org Forge
-- template (config.formId) that a run mutated in place. Those stay templates so the
-- library and by-name lookups keep finding them.
UPDATE "hil_forms" SET "kind" = 'request', "request_source" = 'step'
    WHERE "kind" = 'template' AND "step_execution_id" IS NOT NULL AND NOT ("config" ? 'formId');
