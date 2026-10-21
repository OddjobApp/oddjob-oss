-- Per-organization AgentMail webhooks.
--
-- Each connected organization gets its own AgentMail webhook, limited to its own
-- inbox and signed with its own secret (kept in encrypted_credentials, never here).
-- AgentMail calls /api/integrations/agentmail/webhooks/<token>; only a SHA-256 hash
-- of the token is stored, so this table alone cannot be used to address a webhook.
ALTER TABLE "agentmail_connections" ADD COLUMN IF NOT EXISTS "webhook_id" text;
ALTER TABLE "agentmail_connections" ADD COLUMN IF NOT EXISTS "webhook_token_hash" text;
CREATE UNIQUE INDEX IF NOT EXISTS "agentmail_connections_webhook_token_hash_unq"
    ON "agentmail_connections" ("webhook_token_hash");

-- AgentMail retries a delivery with the same event_id; each is handled once.
CREATE TABLE IF NOT EXISTS "agentmail_webhook_events" (
    "organization_id" integer NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "event_id" text NOT NULL,
    "received_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("organization_id", "event_id")
);
