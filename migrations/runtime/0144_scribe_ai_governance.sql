-- 0144_scribe_ai_governance
--
-- Scribe Studio AI-system governance: four metadata columns on
-- scribe_documents (AI registry id plus three cross-document references), and
-- two new tables — scribe_revisions (immutable content snapshots: the
-- commit log behind diff and rollback) and scribe_reviews (review/approval
-- requests pinned to a revision).
--
-- Everything is guarded so environments that already carry the shape (e.g.
-- via db push) are left unchanged.

-- ── scribe_documents: AI-system metadata ──────────────────────────
ALTER TABLE "scribe_documents" ADD COLUMN IF NOT EXISTS "ai_system_id" text;
ALTER TABLE "scribe_documents" ADD COLUMN IF NOT EXISTS "data_lineage_graph_id" integer;
ALTER TABLE "scribe_documents" ADD COLUMN IF NOT EXISTS "bias_mitigation_strategy_document_id" integer;
ALTER TABLE "scribe_documents" ADD COLUMN IF NOT EXISTS "governance_policy_document_id" integer;

-- ── scribe_revisions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "scribe_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"branch_id" integer,
	"node_id" integer,
	"revision_number" integer NOT NULL,
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"message" text,
	"actor" text DEFAULT 'author' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scribe_revisions_doc_idx" ON "scribe_revisions" ("organization_id", "document_id");
CREATE INDEX IF NOT EXISTS "scribe_revisions_node_idx" ON "scribe_revisions" ("document_id", "node_id");
CREATE UNIQUE INDEX IF NOT EXISTS "scribe_revisions_doc_rev_unique" ON "scribe_revisions" ("document_id", "revision_number");

DO $$ BEGIN
  BEGIN
    ALTER TABLE "scribe_revisions" ADD CONSTRAINT "scribe_revisions_document_id_scribe_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."scribe_documents"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "scribe_revisions" ADD CONSTRAINT "scribe_revisions_branch_id_scribe_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."scribe_branches"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "scribe_revisions" ADD CONSTRAINT "scribe_revisions_node_id_scribe_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."scribe_nodes"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ── scribe_reviews ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "scribe_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"node_id" integer,
	"revision_id" integer,
	"requested_by" text NOT NULL,
	"reviewer" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_note" text,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "scribe_reviews_doc_idx" ON "scribe_reviews" ("organization_id", "document_id");
CREATE INDEX IF NOT EXISTS "scribe_reviews_node_idx" ON "scribe_reviews" ("document_id", "node_id");

DO $$ BEGIN
  BEGIN
    ALTER TABLE "scribe_reviews" ADD CONSTRAINT "scribe_reviews_document_id_scribe_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."scribe_documents"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "scribe_reviews" ADD CONSTRAINT "scribe_reviews_node_id_scribe_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."scribe_nodes"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE "scribe_reviews" ADD CONSTRAINT "scribe_reviews_revision_id_scribe_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."scribe_revisions"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
