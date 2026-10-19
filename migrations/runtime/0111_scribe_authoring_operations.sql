-- An explicit record of every attempt to change a manuscript.
--
-- Until now a station's content was the only evidence that an edit happened, and
-- content cannot say who asked for it, what they asked for, what the agent
-- proposed, which revision it was computed against, or — the one that kept
-- biting — whether the write actually landed. A tool returning
-- "Error updating Scribe station" was recorded as {ok:true}; an autosave was
-- acknowledged before its request was sent; export replied 200 and produced no
-- file. Every one of those was invisible afterwards, because nothing durable
-- described the operation as distinct from its outcome.
--
-- One row per operation, written before the mutation and closed after it, so an
-- attempt that fails leaves a record saying so rather than leaving no trace.
CREATE TABLE IF NOT EXISTS "scribe_authoring_operations" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL,
    "document_id" integer NOT NULL REFERENCES "scribe_documents"("id") ON DELETE CASCADE,

    -- Nullable: an outline reconciliation targets the document, not one station.
    "node_id" integer REFERENCES "scribe_nodes"("id") ON DELETE SET NULL,
    "branch_id" integer,

    -- Where the instruction came from, when it came from a room.
    "session_id" integer,
    "turn_id" integer,
    "actor" text NOT NULL,

    -- What was asked, and under what limits. Kept apart from proposed_content on
    -- purpose: conflating the two is how "I defer to the GhostWriter for content
    -- generation" ended up inside a manuscript as though it were prose.
    "operation" text NOT NULL,
    "request" text,
    "constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,

    -- The prose itself, and the state it was computed against.
    "proposed_content" text,
    "target_revision" integer,
    "applied_revision" integer,

    -- Research provenance, so a claim inserted into a document can still name
    -- the passage it came from. The tool layer already returns file/chunk/score;
    -- nothing persisted it, so it was discarded at the turn boundary.
    "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,

    -- proposed -> applied | rejected | failed. `verified` is set only after the
    -- stored content has been read back and compared, which is the difference
    -- between "the call returned" and "the document changed".
    "status" text DEFAULT 'proposed' NOT NULL,
    "verified" boolean DEFAULT false NOT NULL,
    "failure_reason" text,

    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "settled_at" timestamp with time zone
);

-- The two questions actually asked of this table: what happened to this
-- document, and what happened to this station.
CREATE INDEX IF NOT EXISTS "scribe_authoring_ops_doc_idx"
    ON "scribe_authoring_operations" ("organization_id", "document_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "scribe_authoring_ops_node_idx"
    ON "scribe_authoring_operations" ("node_id", "created_at" DESC);

-- Finding the failures is the point of keeping them, so make it cheap.
CREATE INDEX IF NOT EXISTS "scribe_authoring_ops_status_idx"
    ON "scribe_authoring_operations" ("organization_id", "status")
    WHERE "status" <> 'applied';
