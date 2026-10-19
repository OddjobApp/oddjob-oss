CREATE TABLE IF NOT EXISTS user_saas_connections (
 id serial PRIMARY KEY,
 org_id integer NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 platform text NOT NULL,
 status text NOT NULL DEFAULT 'disconnected',
 config jsonb NOT NULL DEFAULT '{}'::jsonb,
 credential_id integer,
 last_sync_at timestamp with time zone,
 created_at timestamp with time zone NOT NULL DEFAULT now(),
 updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_saas_connection_org_user_platform_unq ON user_saas_connections(org_id, user_id, platform);
CREATE INDEX IF NOT EXISTS user_saas_connection_org_idx ON user_saas_connections(org_id);
CREATE INDEX IF NOT EXISTS user_saas_connection_user_idx ON user_saas_connections(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_docs_granola_external_unq ON knowledge_documents(organization_id, created_by, external_id)
 WHERE metadata->>'source' = 'granola' AND external_id IS NOT NULL;
