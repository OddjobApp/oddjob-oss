-- Human participants in a crew room.
--
-- A room could already represent several humans in its transcript
-- (crew_turns.speaker_type = 'user' with a free-text speaker_name), but there
-- was no record of WHO belonged to a room and no way to attribute a turn to a
-- specific person — every human turn rendered as "You".
--
-- crew_participants answers "who is in this room", mirroring the
-- principal_type/principal_id shape project_members already uses.
-- crew_turns.user_id makes attribution durable rather than cosmetic.

CREATE TABLE "crew_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"invited_by" text,
	"joined_at" timestamp DEFAULT now(),
	"last_seen_at" timestamp,
	CONSTRAINT "crew_participants_role_check" CHECK ("role" IN ('owner', 'member'))
);
--> statement-breakpoint
ALTER TABLE "crew_participants" ADD CONSTRAINT "crew_participants_session_id_crew_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."crew_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "crew_participants_session_user_unique" ON "crew_participants" USING btree ("session_id","user_id");
--> statement-breakpoint
CREATE INDEX "idx_crew_participants_user" ON "crew_participants" USING btree ("user_id");

-- Attribute a turn to the person who wrote it. Nullable: agent and supervisor
-- turns have no user, and turns predating this migration have no attribution.
--> statement-breakpoint
ALTER TABLE "crew_turns"
  ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_crew_turns_user" ON "crew_turns" USING btree ("user_id");
