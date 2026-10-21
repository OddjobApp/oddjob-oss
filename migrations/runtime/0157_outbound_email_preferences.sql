CREATE TABLE outbound_email_preferences (
 organization_id integer NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 connector_id integer REFERENCES saas_connectors(id) ON DELETE SET NULL,
 email text NOT NULL,
 provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id, user_id)
);
