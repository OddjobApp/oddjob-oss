-- 0125_media_shot_cutaway_anchor
--
-- A cutaway hangs off a shot, not off a second.
--
-- 0123 gave an overlay `start_time_seconds`, an absolute offset into the timeline. That
-- is the one place this model diverged from the editors it copies, and it produces wrong
-- cuts silently: trim any earlier shot by half a second and every cutaway slides half a
-- second late, landing on the wrong line, with nothing on screen to say so. Final Cut's
-- connected clips instead attach to a point in a primary clip and move with it.
--
-- So an overlay now records WHICH shot it is connected to and how far into that shot it
-- begins. The absolute time is worked out when the reel is cut, from the shots as they
-- stand, which is the only moment it is actually true.
--
-- `start_time_seconds` stays for overlays created before this migration: with no anchor,
-- it is still the best answer anyone has for where they sit. New overlays set an anchor,
-- and the resolver prefers it.
--
-- ON DELETE CASCADE, deliberately: a cutaway whose anchor has been deleted is connected
-- to nothing, and leaving it floating at a stale offset is exactly the failure this
-- migration exists to remove.
--
-- Idempotent.

ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "anchor_shot_id" integer;
ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "anchor_offset_seconds" real;

DO $$ BEGIN
	ALTER TABLE "media_shots" ADD CONSTRAINT "media_shots_anchor_shot_id_fk"
		FOREIGN KEY ("anchor_shot_id") REFERENCES "public"."media_shots"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A shot cannot hang off itself, and an anchored clip starts somewhere in its anchor.
DO $$ BEGIN
	ALTER TABLE "media_shots" ADD CONSTRAINT "media_shots_anchor_not_self_check" CHECK (
		"anchor_shot_id" IS NULL OR "anchor_shot_id" <> "id"
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	ALTER TABLE "media_shots" ADD CONSTRAINT "media_shots_anchor_offset_check" CHECK (
		"anchor_offset_seconds" IS NULL OR "anchor_offset_seconds" >= 0
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only an overlay hangs off another shot; a primary clip follows the one before it.
DO $$ BEGIN
	ALTER TABLE "media_shots" ADD CONSTRAINT "media_shots_anchor_is_overlay_check" CHECK (
		"anchor_shot_id" IS NULL OR "track" = 2
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "media_shots_anchor_idx" ON "media_shots" USING btree ("anchor_shot_id");
