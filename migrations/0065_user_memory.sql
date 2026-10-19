-- Per-user assistant memory: durable preferences/facts recalled across sessions.
CREATE TABLE IF NOT EXISTS "user_memory" (
    "id" serial PRIMARY KEY,
    "user_id" text NOT NULL,
    "organization_id" integer REFERENCES "orgs"("org_id"),
    "content" text NOT NULL,
    "kind" text NOT NULL DEFAULT 'fact',
    "source" text NOT NULL DEFAULT 'assistant',
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "user_memory_user_idx" ON "user_memory" ("user_id");
CREATE INDEX IF NOT EXISTS "user_memory_user_org_idx" ON "user_memory" ("user_id", "organization_id");
