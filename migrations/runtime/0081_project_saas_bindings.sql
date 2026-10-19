-- A project binds many external resources through one connection.
--
-- Migration 0080 let a project own a connector, with the bound Jira project or
-- Confluence space living in `config`. That allows exactly one resource per
-- platform per project: selecting a second space would overwrite the first.
--
-- A connector is the site plus credential; a space or a Jira project is a
-- resource inside it. Separating them lets one Confluence connection serve ENG
-- and DOCS as two bindings — and each binding becomes its own assembly piece,
-- with its own schema snapshot and sync state.
--
-- The binding is an organizing boundary, not a security one: credentials remain
-- on the connector, so binding ENG to a project does not stop the same token
-- reading every other space.

CREATE TABLE IF NOT EXISTS project_saas_bindings (
    id serial PRIMARY KEY,
    org_id integer NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    connector_id integer NOT NULL REFERENCES saas_connectors(id) ON DELETE CASCADE,

    -- 'confluence_space' | 'jira_project'. Text rather than an enum so a new
    -- platform does not need a migration to be representable.
    resource_kind text NOT NULL,
    -- The stable identifier the remote system uses: a space key, a project key.
    resource_key text NOT NULL,
    -- Human name and subtype as discovered, so the surface can label a binding
    -- without a round trip. ConfluenceSpace.type is global/personal;
    -- JiraProject.projectTypeKey is software/business.
    resource_name text,
    resource_type text,
    -- The remote numeric/string id and deep link, kept so the surface can link
    -- out and so a rename of the key can be detected rather than silently
    -- creating a second binding.
    external_id text,
    web_url text,

    bound_by text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- The same resource cannot be bound to the same project twice through the same
-- connection. Different projects may bind the same space, which is legitimate.
CREATE UNIQUE INDEX IF NOT EXISTS project_saas_binding_unq
    ON project_saas_bindings (project_id, connector_id, resource_key);

-- Listing a project's bindings is the read the surface and the Integrations tab
-- are both built on.
CREATE INDEX IF NOT EXISTS project_saas_binding_project_idx
    ON project_saas_bindings (project_id);

CREATE INDEX IF NOT EXISTS project_saas_binding_connector_idx
    ON project_saas_bindings (connector_id);
