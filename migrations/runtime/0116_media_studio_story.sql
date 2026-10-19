-- 0116_media_studio_story
--
-- A production's story lives in a Scribe manuscript: the production links to it, and
-- each scene can link to the station that tells it. Scenes gain their direction
-- (location, time of day, mood); shots gain framing, lens, action and the dialogue
-- the video model speaks, as structured lines rather than prose inside a prompt.
--
-- Idempotent.

ALTER TABLE "media_productions" ADD COLUMN IF NOT EXISTS "scribe_document_id" integer;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "media_productions" ADD CONSTRAINT "media_productions_scribe_document_fk"
        FOREIGN KEY ("scribe_document_id") REFERENCES "scribe_documents"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "media_scenes" ADD COLUMN IF NOT EXISTS "scribe_node_id" integer;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "media_scenes" ADD CONSTRAINT "media_scenes_scribe_node_fk"
        FOREIGN KEY ("scribe_node_id") REFERENCES "scribe_nodes"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "media_scenes" ADD COLUMN IF NOT EXISTS "location" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_scenes" ADD COLUMN IF NOT EXISTS "time_of_day" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_scenes" ADD COLUMN IF NOT EXISTS "mood" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "framing" text;
--> statement-breakpoint
ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "lens" text;
--> statement-breakpoint
ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "action" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media_shots" ADD COLUMN IF NOT EXISTS "dialogue" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "media_shots" ADD CONSTRAINT "media_shots_dialogue_array_check" CHECK (jsonb_typeof("dialogue") = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
