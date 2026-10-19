-- 0141_organization_invites
--
-- Invitation tokens for adding new members to an existing organization.
-- Admins create invites; invitees follow a link to register and are added to
-- the inviting organization rather than provisioning their own.

CREATE TABLE IF NOT EXISTS "organization_invites" (
    "id" SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL REFERENCES "orgs"("org_id") ON DELETE CASCADE,
    "email" TEXT,
    "role" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL UNIQUE,
    "invited_by" VARCHAR(255) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "used_at" TIMESTAMP,
    "used_by" VARCHAR(255) REFERENCES "users"("id") ON DELETE SET NULL,
    "expires_at" TIMESTAMP NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "organization_invites_token_hash_idx"
    ON "organization_invites" ("token_hash");

CREATE INDEX IF NOT EXISTS "organization_invites_org_idx"
    ON "organization_invites" ("organization_id");
