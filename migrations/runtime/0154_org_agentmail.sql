CREATE TABLE IF NOT EXISTS "agentmail_connections" (
    "organization_id" integer PRIMARY KEY REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "inbox_id" text NOT NULL UNIQUE,
    "updated_at" timestamptz NOT NULL DEFAULT now()
);
