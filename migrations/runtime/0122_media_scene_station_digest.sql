-- 0122_media_scene_station_digest
--
-- A scene derived from a Scribe station kept no record of what the station said
-- at the time. Its synopsis is a snapshot taken at import; the station's text is
-- read live. So after the manuscript was edited the studio showed the new text
-- in the quote and the old text in the synopsis, side by side, with nothing to
-- say they had diverged — and re-importing skipped every station it had already
-- seen, so there was no way to bring a scene back into step.
--
-- This is the digest of the station as the scene was last derived from it.
-- Comparing it to the station now is what makes the drift visible, and what a
-- re-sync updates when the author asks for one. NULL means a scene that was
-- never derived from a station, or one derived before this column existed.
--
-- Idempotent.

ALTER TABLE "media_scenes" ADD COLUMN IF NOT EXISTS "station_digest" text;
