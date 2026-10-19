-- Attachments: a stored blob, and the rooms that reference it.
--
-- Split in two on purpose. The bytes are content-addressed, so the same deck
-- attached in three rooms is ONE blob with three references — dedupe, and a
-- re-upload of an identical file reuses the parse instead of repeating it.
-- Merging the two would make the parsed text and the index state duplicate per
-- room, and they would drift.
--
-- Scope is the project, per the design: an attachment belongs to a project
-- space, and reaching beyond it is a separate, approved act.

CREATE TABLE IF NOT EXISTS file_blobs (
    id serial PRIMARY KEY,
    org_id integer NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,

    -- sha256 of the bytes. Unique per org rather than globally: two orgs
    -- uploading the same file must not share a row, or deleting one org's
    -- copy would remove the other's.
    content_hash text NOT NULL,
    storage_path text NOT NULL,
    byte_size integer NOT NULL,
    mime_type text,
    original_name text,

    -- Parse output, produced once at ingest. `parse_type` mirrors
    -- FileParser's discriminator (table | json | text | image | bpmn).
    parse_status text NOT NULL DEFAULT 'pending',
    parse_type text,
    parsed_text text,
    parse_error text,
    -- Structured extraction that is not flat text — the BPMN process graph,
    -- a CSV's columns. Kept out of parsed_text so retrieval does not embed it.
    parsed_data jsonb,
    -- The FULL character count before any chunking, so a truncated preview can
    -- never be mistaken for the whole document.
    text_length integer,

    -- Index state is explicit. NULL point id plus 'indexed' is a contradiction
    -- the reader can catch; "not indexed yet" must never look like "indexed and
    -- empty". Same discipline as knowledge_documents.qdrant_point_id.
    index_status text NOT NULL DEFAULT 'pending',
    index_error text,
    indexed_at timestamp with time zone,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS file_blob_org_hash_unq
    ON file_blobs (org_id, content_hash);

CREATE INDEX IF NOT EXISTS file_blob_index_status_idx
    ON file_blobs (index_status) WHERE index_status <> 'indexed';

CREATE TABLE IF NOT EXISTS crew_attachments (
    id serial PRIMARY KEY,
    org_id integer NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    -- NOT NULL: an attachment without a project has no scope, and an unscoped
    -- document is exactly the leak this design is meant to prevent.
    project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    session_id integer NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
    blob_id integer NOT NULL REFERENCES file_blobs(id) ON DELETE CASCADE,

    -- The name as uploaded HERE. The same blob may be attached under different
    -- names in different rooms, and each room should show the name it was given.
    display_name text NOT NULL,
    uploaded_by text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Attaching the same file to the same room twice is a no-op, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS crew_attachment_session_blob_unq
    ON crew_attachments (session_id, blob_id);

CREATE INDEX IF NOT EXISTS crew_attachment_session_idx
    ON crew_attachments (session_id);

-- The Files listing reads by project.
CREATE INDEX IF NOT EXISTS crew_attachment_project_idx
    ON crew_attachments (project_id);
