-- 0120_media_studio_comfyui
--
-- A production chooses how its takes render: Seedance on fal.ai, as before, or a
-- ComfyUI server with a workflow imported in ComfyUI's API format. The workflow is
-- stored with which inputs a take fills in (prompt, negative prompt, seeds, start and
-- end images, frame count) and the rate it saves video at. Each take keeps its own copy
-- of the workflow in its request, so importing another later cannot change a take
-- already asked for.
--
-- Idempotent.

ALTER TABLE "media_productions" ADD COLUMN IF NOT EXISTS "video_engine" text DEFAULT 'fal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_productions" ADD COLUMN IF NOT EXISTS "comfy_workflow" jsonb;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "media_productions" ADD CONSTRAINT "media_productions_video_engine_check" CHECK ("video_engine" IN ('fal', 'comfyui'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
