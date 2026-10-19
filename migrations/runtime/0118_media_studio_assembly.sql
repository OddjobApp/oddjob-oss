-- 0118_media_studio_assembly
--
-- Scene reels are cut by ffmpeg in the API process, one at a time per organization.
-- The index holds that rule even when two requests arrive together; a reel left
-- "assembling" by a restart stops sending its heartbeat and is marked failed before
-- the next one starts, so it cannot hold the slot forever.
--
-- Idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS "media_assemblies_one_running_per_org"
    ON "media_assemblies" ("organization_id")
    WHERE "status" = 'assembling';
