-- Visitor intent states and engagement logs belong to an organization.
--
-- Both tables were keyed only by a browser fingerprint, so every reader (the
-- MCP resource oddjob://ephemeral/state, the get_user_intent tool, prompt
-- context) could see any organization's rows. Nothing writes them today; a row
-- without an organization is visible to no one, so a future writer must stamp it.
ALTER TABLE "contact_intent_states" ADD COLUMN IF NOT EXISTS "organization_id" integer
    REFERENCES "orgs"("org_id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_intent_org_user" ON "contact_intent_states" ("organization_id", "user_fingerprint");

ALTER TABLE "engagement_logs" ADD COLUMN IF NOT EXISTS "organization_id" integer
    REFERENCES "orgs"("org_id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_eng_org_user" ON "engagement_logs" ("organization_id", "user_fingerprint");
