-- Migration 011: AIP-style Ontology (org-scoped business Object Types + typed Actions).
-- Mirrors shared/schema/ontology/ontology.ts. Distinct from the knowledge graph:
-- this layer holds curated business objects + governed actions the assistant can act on.
-- See docs/specs/ONTOLOGY_SERVICE_DESIGN.md.

CREATE TABLE IF NOT EXISTS ontology_object_types (
    id                SERIAL PRIMARY KEY,
    organization_id   INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    description       TEXT,
    properties_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    title_property    TEXT,
    icon              TEXT,
    backing           TEXT NOT NULL DEFAULT 'materialized',
    source_adapter    TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_by        TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ontology_object_type_org_name_unique ON ontology_object_types(organization_id, name);
CREATE INDEX IF NOT EXISTS ontology_object_type_org_idx ON ontology_object_types(organization_id);

CREATE TABLE IF NOT EXISTS ontology_objects (
    id                SERIAL PRIMARY KEY,
    organization_id   INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    object_type_id    INTEGER NOT NULL REFERENCES ontology_object_types(id) ON DELETE CASCADE,
    external_id       TEXT,
    properties        JSONB NOT NULL DEFAULT '{}'::jsonb,
    kg_node_id        INTEGER,
    created_by        TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ontology_object_org_type_extid_unique
    ON ontology_objects(organization_id, object_type_id, external_id)
    WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ontology_object_org_type_idx ON ontology_objects(organization_id, object_type_id);

CREATE TABLE IF NOT EXISTS ontology_actions (
    id                SERIAL PRIMARY KEY,
    organization_id   INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    description       TEXT,
    object_type_id    INTEGER REFERENCES ontology_object_types(id) ON DELETE CASCADE,
    parameters_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    effect            TEXT NOT NULL DEFAULT 'read',
    handler_kind      TEXT NOT NULL,
    handler_ref       TEXT NOT NULL,
    requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    risk_level        TEXT NOT NULL DEFAULT 'medium',
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_by        TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ontology_action_org_name_unique ON ontology_actions(organization_id, name);
CREATE INDEX IF NOT EXISTS ontology_action_org_idx ON ontology_actions(organization_id);

CREATE TABLE IF NOT EXISTS ontology_action_log (
    id                SERIAL PRIMARY KEY,
    organization_id   INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    action_id         INTEGER REFERENCES ontology_actions(id) ON DELETE SET NULL,
    actor_user_id     TEXT,
    params            JSONB,
    approval_id       INTEGER,
    status            TEXT NOT NULL,
    result            JSONB,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ontology_action_log_org_idx ON ontology_action_log(organization_id);
