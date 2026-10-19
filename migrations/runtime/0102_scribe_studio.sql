-- Scribe Studio: longform authoring, contract engineering, multi-lens critic
-- annotations, and branching subway trees.
--
-- Mirrors shared/schema/scribe.ts. The tables were previously created only by a
-- hand-run script, which left them absent from every environment where nobody
-- happened to run it.

CREATE TABLE IF NOT EXISTS "scribe_documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "session_id" integer NOT NULL REFERENCES "crew_sessions"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "archetype_mode" text DEFAULT 'freeform' NOT NULL,
  "active_branch_id" integer,
  "current_revision" integer DEFAULT 1 NOT NULL,
  "target_word_count" integer,
  "settings" jsonb DEFAULT '{"autoContinuity":true,"ghostWriter":true,"defaultLenses":["legal","stylistic","devils_advocate"]}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scribe_docs_org_idx" ON "scribe_documents" ("organization_id");
CREATE INDEX IF NOT EXISTS "scribe_docs_session_idx" ON "scribe_documents" ("session_id");

CREATE TABLE IF NOT EXISTS "scribe_branches" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL REFERENCES "scribe_documents"("id") ON DELETE cascade,
  "branch_key" text NOT NULL,
  "parent_branch_id" integer,
  "breakout_session_id" integer REFERENCES "crew_sessions"("id") ON DELETE set null,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active' NOT NULL,
  "diverged_at_station_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scribe_branches_doc_idx" ON "scribe_branches" ("document_id");
CREATE UNIQUE INDEX IF NOT EXISTS "scribe_branches_doc_key_unique" ON "scribe_branches" ("document_id", "branch_key");

CREATE TABLE IF NOT EXISTS "scribe_nodes" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL REFERENCES "scribe_documents"("id") ON DELETE cascade,
  "branch_id" integer NOT NULL REFERENCES "scribe_branches"("id") ON DELETE cascade,
  "station_key" text NOT NULL,
  "title" text NOT NULL,
  "sort_order" integer NOT NULL,
  "target_percentage" real,
  "content" text DEFAULT '' NOT NULL,
  "content_rich" jsonb,
  "word_count" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "continuity_notes" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scribe_nodes_doc_branch_idx" ON "scribe_nodes" ("document_id", "branch_id");
CREATE INDEX IF NOT EXISTS "scribe_nodes_sort_idx" ON "scribe_nodes" ("branch_id", "sort_order");

CREATE TABLE IF NOT EXISTS "scribe_annotations" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL REFERENCES "scribe_documents"("id") ON DELETE cascade,
  "node_id" integer NOT NULL REFERENCES "scribe_nodes"("id") ON DELETE cascade,
  "agent_card_id" integer REFERENCES "agent_cards"("id") ON DELETE set null,
  "lens_type" text NOT NULL,
  "paragraph_anchor" text,
  "severity" text DEFAULT 'info' NOT NULL,
  "title" text NOT NULL,
  "critique_body" text NOT NULL,
  "proposed_diff" text,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scribe_annot_doc_idx" ON "scribe_annotations" ("document_id");
CREATE INDEX IF NOT EXISTS "scribe_annot_node_idx" ON "scribe_annotations" ("node_id");

CREATE TABLE IF NOT EXISTS "scribe_entity_ledger" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL REFERENCES "scribe_documents"("id") ON DELETE cascade,
  "entity_type" text NOT NULL,
  "term_name" text NOT NULL,
  "definition_text" text,
  "first_defined_node_id" integer REFERENCES "scribe_nodes"("id") ON DELETE set null,
  "data_binding" jsonb,
  "aliases" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scribe_ledger_doc_idx" ON "scribe_entity_ledger" ("document_id");
CREATE UNIQUE INDEX IF NOT EXISTS "scribe_ledger_doc_term_unique" ON "scribe_entity_ledger" ("document_id", "term_name");
