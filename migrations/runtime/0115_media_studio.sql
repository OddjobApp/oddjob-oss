-- 0115_media_studio
--
-- Media Studio kept nothing: its shots were a demo storyboard in component state,
-- Seedance jobs lived in an in-memory map, and a "reel" was a URL nobody made.
-- These tables hold a production's storyboard (scenes, plot points, keyframe
-- renders), its film (shots and their takes), the files they produce, and scene
-- assemblies.
--
-- Every row carries organization_id and is read by equality. A production may
-- belong to a CREW room and to a Project Space; a private project's production is
-- visible only to that project's members. Money is integer cents. At most one take
-- per shot, and one keyframe per plot point, is approved.
--
-- Idempotent: every object is created only if missing.

CREATE TABLE IF NOT EXISTS "media_productions" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "project_id" integer REFERENCES "projects"("id") ON DELETE SET NULL,
    "crew_session_id" integer REFERENCES "crew_sessions"("id") ON DELETE SET NULL,
    "title" text NOT NULL,
    "aspect_ratio" text DEFAULT '16:9' NOT NULL,
    "budget_limit_cents" integer DEFAULT 2500 NOT NULL,
    -- Scene keys (SCENE-01, SCENE-02…) come from this counter, so a deleted scene's
    -- key is never given to a new one.
    "scene_counter" integer DEFAULT 0 NOT NULL,
    "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "media_productions_aspect_check" CHECK ("aspect_ratio" IN ('16:9', '9:16', '2.39:1', '4:3', '1:1')),
    CONSTRAINT "media_productions_budget_check" CHECK ("budget_limit_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_productions_org_idx" ON "media_productions" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_productions_session_idx" ON "media_productions" ("crew_session_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_scenes" (
    "id" serial PRIMARY KEY,
    "production_id" integer NOT NULL REFERENCES "media_productions"("id") ON DELETE CASCADE,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "position" integer NOT NULL,
    "scene_key" text NOT NULL,
    "title" text NOT NULL,
    "synopsis" text DEFAULT '' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_scenes_production_key_unique" ON "media_scenes" ("production_id", "scene_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_scenes_production_position_idx" ON "media_scenes" ("production_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_plot_points" (
    "id" serial PRIMARY KEY,
    "scene_id" integer NOT NULL REFERENCES "media_scenes"("id") ON DELETE CASCADE,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "position" integer NOT NULL,
    "title" text NOT NULL,
    "beat" text DEFAULT '' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_plot_points_scene_position_idx" ON "media_plot_points" ("scene_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_assets" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "production_id" integer NOT NULL REFERENCES "media_productions"("id") ON DELETE CASCADE,
    "kind" text NOT NULL,
    "storage_path" text NOT NULL,
    "mime_type" text NOT NULL,
    "byte_size" integer NOT NULL,
    "duration_seconds" integer,
    "width" integer,
    "height" integer,
    "source" text NOT NULL,
    "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "media_assets_kind_check" CHECK ("kind" IN ('image', 'video', 'reel'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_assets_production_idx" ON "media_assets" ("production_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_keyframes" (
    "id" serial PRIMARY KEY,
    "plot_point_id" integer NOT NULL REFERENCES "media_plot_points"("id") ON DELETE CASCADE,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "prompt" text NOT NULL,
    "status" text DEFAULT 'draft' NOT NULL,
    "provider" text,
    "mode" text,
    "cost_cents" integer DEFAULT 0 NOT NULL,
    "image_asset_id" integer REFERENCES "media_assets"("id") ON DELETE SET NULL,
    "approval_id" integer,
    "error" text,
    "is_selected" boolean DEFAULT false NOT NULL,
    "requested_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "decided_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "submitted_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "media_keyframes_status_check" CHECK ("status" IN ('draft', 'pending_approval', 'rendering', 'ready', 'approved', 'rejected', 'failed')),
    CONSTRAINT "media_keyframes_mode_check" CHECK ("mode" IS NULL OR "mode" IN ('live', 'simulation')),
    CONSTRAINT "media_keyframes_cost_check" CHECK ("cost_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_keyframes_plot_point_idx" ON "media_keyframes" ("plot_point_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_keyframes_selected_unique" ON "media_keyframes" ("plot_point_id") WHERE "is_selected" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_keyframes_approved_unique" ON "media_keyframes" ("plot_point_id") WHERE "status" = 'approved';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_shots" (
    "id" serial PRIMARY KEY,
    "scene_id" integer NOT NULL REFERENCES "media_scenes"("id") ON DELETE CASCADE,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "position" integer NOT NULL,
    "plot_point_id" integer REFERENCES "media_plot_points"("id") ON DELETE SET NULL,
    "prompt" text DEFAULT '' NOT NULL,
    "negative_prompt" text,
    "camera_motion" text,
    "seed" text,
    "duration_seconds" integer DEFAULT 5 NOT NULL,
    "transition" text DEFAULT 'cut' NOT NULL,
    "reference_keyframe_id" integer REFERENCES "media_keyframes"("id") ON DELETE SET NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "media_shots_duration_check" CHECK ("duration_seconds" BETWEEN 1 AND 60),
    CONSTRAINT "media_shots_transition_check" CHECK ("transition" IN ('cut', 'crossfade', 'dip_to_black'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_shots_scene_position_idx" ON "media_shots" ("scene_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_takes" (
    "id" serial PRIMARY KEY,
    "shot_id" integer NOT NULL REFERENCES "media_shots"("id") ON DELETE CASCADE,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "take_number" integer NOT NULL,
    "prompt" text NOT NULL,
    "negative_prompt" text,
    "camera_motion" text,
    "seed" text,
    "duration_seconds" integer NOT NULL,
    "status" text NOT NULL,
    "mode" text NOT NULL,
    "generation_id" text,
    "video_asset_id" integer REFERENCES "media_assets"("id") ON DELETE SET NULL,
    "cost_cents" integer DEFAULT 0 NOT NULL,
    "defect_class" text,
    "notes" text,
    "approval_id" integer,
    "error" text,
    "requested_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "decided_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "submitted_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "media_takes_status_check" CHECK ("status" IN ('pending_approval', 'queued', 'rendering', 'ready_for_review', 'approved', 'rejected', 'failed', 'simulated')),
    CONSTRAINT "media_takes_mode_check" CHECK ("mode" IN ('live', 'simulation')),
    CONSTRAINT "media_takes_defect_check" CHECK ("defect_class" IS NULL OR "defect_class" IN ('character_drift', 'unnatural_motion', 'wrong_framing', 'lighting_mismatch', 'artifact_glitch')),
    CONSTRAINT "media_takes_cost_check" CHECK ("cost_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_takes_shot_number_unique" ON "media_takes" ("shot_id", "take_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_takes_approved_unique" ON "media_takes" ("shot_id") WHERE "status" = 'approved';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_assemblies" (
    "id" serial PRIMARY KEY,
    "scene_id" integer NOT NULL REFERENCES "media_scenes"("id") ON DELETE CASCADE,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "status" text NOT NULL,
    "manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "reel_asset_id" integer REFERENCES "media_assets"("id") ON DELETE SET NULL,
    "error" text,
    "requested_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "media_assemblies_status_check" CHECK ("status" IN ('assembling', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_assemblies_scene_idx" ON "media_assemblies" ("scene_id");
