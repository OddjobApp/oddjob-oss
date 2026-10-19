-- 0121_media_studio_decisions
--
-- Two things a film needs that the studio could not hold.
--
-- Themes. A reference image was a character or a place, and both are about
-- something IN the story. A theme is about none of it: it is a mood board that
-- says what the whole film looks like, sent with every keyframe so the palette,
-- light and grain hold from frame to frame. The kind check has to be widened or
-- the row cannot be written at all.
--
-- Decisions. Applying a change, a story or a Style Bible wrote the change and
-- kept no trace of it: who asked, what they asked for in their own words, what
-- it altered, and what was left out. That history lived only in a CREW room's
-- transcript, so it was lost to anyone reading the production afterwards and
-- gone entirely if the room was. A production should be able to say how it came
-- to look the way it does.
--
-- Idempotent.

ALTER TABLE "media_references" DROP CONSTRAINT IF EXISTS "media_references_kind_check";
--> statement-breakpoint
ALTER TABLE "media_references" ADD CONSTRAINT "media_references_kind_check" CHECK (kind IN ('character', 'location', 'theme'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_decisions" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "production_id" integer NOT NULL REFERENCES "media_productions"("id") ON DELETE CASCADE,
    -- What was decided: 'story', 'scene_change' or 'style_bible'.
    "kind" text NOT NULL,
    -- The card's id. Unique, so applying the same card twice records once.
    "proposal_id" text NOT NULL,
    -- The scene it was about, when it was about one. Kept if the scene is deleted.
    "scene_id" integer REFERENCES "media_scenes"("id") ON DELETE SET NULL,
    "scene_key" text,
    -- What the author asked for, in their own words.
    "instruction" text DEFAULT '' NOT NULL,
    -- What it changed, one line each, as the card described it.
    "summary" jsonb DEFAULT '[]'::jsonb NOT NULL,
    -- Parts of the request that were not carried out, and why.
    "skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
    -- The room it was decided in, when it was decided in one.
    "crew_session_id" integer REFERENCES "crew_sessions"("id") ON DELETE SET NULL,
    "decided_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_decisions_production_idx" ON "media_decisions" ("production_id", "created_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_decisions_proposal_unique" ON "media_decisions" ("proposal_id");
--> statement-breakpoint
ALTER TABLE "media_decisions" DROP CONSTRAINT IF EXISTS "media_decisions_kind_check";
--> statement-breakpoint
ALTER TABLE "media_decisions" ADD CONSTRAINT "media_decisions_kind_check" CHECK (kind IN ('story', 'scene_change', 'style_bible'));
--> statement-breakpoint

-- Wardrobe.
--
-- What a character wears was a single paragraph on the Style Bible, applied to
-- every frame of the film at once — so "she puts on a heavier coat in scene
-- three" could only be written as a rule about the whole production, and the
-- coat appeared in the flashback too. A character anchor carried a `wardrobe`
-- field that nothing ever read.
--
-- A garment here belongs to one character and starts at one scene, and holds
-- until another garment for that character supersedes it. A null start means it
-- is worn from the beginning. That is how costume continuity actually works on a
-- production, and it means a costume change is one new row rather than an edit
-- to two.
--
-- The garment is primarily DATA: it composes into the character's reference
-- sheet and into the prompt of every scene it covers. A plate of the garment on
-- its own is rendered only when someone asks for one.
CREATE TABLE IF NOT EXISTS "media_wardrobe" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "production_id" integer NOT NULL REFERENCES "media_productions"("id") ON DELETE CASCADE,
    -- Who wears it, matched by name against the production's characters.
    "character_name" text NOT NULL,
    -- What it is: "heavy charcoal wool coat, knee length, worn open".
    "garment" text NOT NULL,
    -- How it is worn, and its condition as the story goes on.
    "notes" text DEFAULT '' NOT NULL,
    -- Worn from this scene onward. NULL means from the production's first scene.
    "from_scene_id" integer REFERENCES "media_scenes"("id") ON DELETE SET NULL,
    -- The plate, when one was asked for.
    "image_asset_id" integer REFERENCES "media_assets"("id") ON DELETE SET NULL,
    "plate_status" text DEFAULT 'none' NOT NULL,
    "plate_prompt" text,
    "cost_cents" integer DEFAULT 0 NOT NULL,
    "error" text,
    "requested_by" text REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_wardrobe_production_idx" ON "media_wardrobe" ("production_id");
--> statement-breakpoint
-- One garment per character per starting scene: saying it twice is an edit, not a
-- second costume. Scenes are distinguished from "from the beginning" by coalesce.
CREATE UNIQUE INDEX IF NOT EXISTS "media_wardrobe_character_scene_unique"
    ON "media_wardrobe" ("production_id", lower("character_name"), COALESCE("from_scene_id", 0));
--> statement-breakpoint
ALTER TABLE "media_wardrobe" DROP CONSTRAINT IF EXISTS "media_wardrobe_plate_status_check";
--> statement-breakpoint
ALTER TABLE "media_wardrobe" ADD CONSTRAINT "media_wardrobe_plate_status_check" CHECK (plate_status IN ('none', 'rendering', 'ready', 'failed'));
