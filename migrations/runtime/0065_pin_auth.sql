-- PIN-based step-up authentication.
--
-- These objects previously existed only in server/scripts/migrate-pin-schema.ts,
-- a hand-run script. shared/schema/auth.ts declared `users.pin` and
-- `pin_reset_tokens`, so tsc and the unit suite stayed green while the table
-- existed in no environment that had not run the script by hand.
--
-- Written idempotently so it is a no-op on any database where that script was
-- already run.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pin" text;

CREATE TABLE IF NOT EXISTS "pin_reset_tokens" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" varchar NOT NULL,
    "token_hash" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "used" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE "pin_reset_tokens"
        ADD CONSTRAINT "pin_reset_tokens_user_id_users_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "pin_token_hash_idx" ON "pin_reset_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "pin_user_id_idx" ON "pin_reset_tokens" ("user_id");
