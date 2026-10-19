-- 0113_form_studio_revisions
--
-- Form Studio kept its undo history as up to 30 full snapshots inside the form's
-- own config column, and "publishing" overwrote a single embedded copy. So a form
-- had no durable history, no way to restore an older version, and no record of
-- what earlier respondents had been answering once it was republished.
--
-- A `revision` is one saved state of a form's draft, ordered by `seq`; undo and
-- redo move along them. A `release` is what publishing froze (v1, v2…), with a
-- `{ fields }` projection for renderers and built apps that predate Form Studio.
-- The draft stays on the hil_forms row, so form ids and readers are unchanged.
--
-- Idempotent: every object is created only if missing.

CREATE TABLE IF NOT EXISTS "form_studio_revisions" (
    "id" serial PRIMARY KEY,
    "form_id" integer NOT NULL REFERENCES "hil_forms"("id") ON DELETE CASCADE,
    "organization_id" integer REFERENCES "orgs"("org_id") ON DELETE SET NULL,
    "kind" text NOT NULL,
    "seq" integer,
    "release_number" integer,
    "form_revision" integer NOT NULL,
    "name" text NOT NULL,
    "schema" jsonb NOT NULL,
    "fields_projection" jsonb,
    "theme_config" jsonb,
    "security_config" jsonb,
    "summary" text DEFAULT '' NOT NULL,
    -- Set when an undo is followed by a new edit: the undone revisions leave the
    -- undo chain but stay listed, so saved work is never silently lost.
    "discarded_at" timestamp,
    "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "form_studio_revisions_kind_check" CHECK (
        ("kind" = 'revision' AND "seq" IS NOT NULL AND "release_number" IS NULL)
        OR ("kind" = 'release' AND "release_number" IS NOT NULL AND "seq" IS NULL)
    )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_studio_revisions_form_kind_idx" ON "form_studio_revisions" ("form_id", "kind");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "form_studio_revisions_form_seq_idx" ON "form_studio_revisions" ("form_id", "seq") WHERE "kind" = 'revision';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "form_studio_revisions_form_release_idx" ON "form_studio_revisions" ("form_id", "release_number") WHERE "kind" = 'release';
