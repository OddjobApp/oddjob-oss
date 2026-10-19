-- 0119_media_studio_look
--
-- Keeping a film consistent from frame to frame. A production has a look (its
-- style, palette and light), written once and added to every keyframe and take
-- prompt. Characters and locations get reference images, rendered with Gemini and
-- approved like keyframes; an approved reference is sent with each keyframe that
-- shows that character or place, and each keyframe records which reference images
-- it was rendered with. A production uses one approved reference per character or
-- place, matched by name regardless of case.
--
-- Idempotent.

ALTER TABLE "media_productions" ADD COLUMN IF NOT EXISTS "style" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_keyframes" ADD COLUMN IF NOT EXISTS "reference_images" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_references" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "production_id" integer NOT NULL REFERENCES "media_productions"("id") ON DELETE CASCADE,
    "kind" text NOT NULL,
    "name" text NOT NULL,
    "prompt" text NOT NULL,
    "status" text DEFAULT 'rendering' NOT NULL,
    "provider" text,
    "mode" text,
    "cost_cents" integer DEFAULT 0 NOT NULL,
    "image_asset_id" integer REFERENCES "media_assets"("id") ON DELETE SET NULL,
    "error" text,
    "requested_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "decided_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "submitted_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "media_references_kind_check" CHECK ("kind" IN ('character', 'location')),
    CONSTRAINT "media_references_status_check" CHECK ("status" IN ('rendering', 'ready', 'approved', 'rejected', 'failed')),
    CONSTRAINT "media_references_mode_check" CHECK ("mode" IS NULL OR "mode" IN ('live', 'simulation')),
    CONSTRAINT "media_references_cost_check" CHECK ("cost_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_references_production_idx" ON "media_references" ("production_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_references_approved_unique"
    ON "media_references" ("production_id", "kind", lower("name"))
    WHERE "status" = 'approved';
