-- 0124_scribe_vault_records
--
-- Confidential Orchestration & Redaction Engine (CORE) Vault Records.
-- Stores encrypted payloads for sandboxed and redacted prose blocks,
-- scoped strictly to organizationId for multi-tenant isolation.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "scribe_vault_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"document_id" integer NOT NULL REFERENCES "scribe_documents"("id") ON DELETE CASCADE,
	"node_id" integer REFERENCES "scribe_nodes"("id") ON DELETE SET NULL,
	"token_id" text NOT NULL UNIQUE,
	"slug" text,
	"classification" text DEFAULT 'confidential' NOT NULL,
	"mode" text DEFAULT 'static_reinsert' NOT NULL,
	"summary" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"local_model_hint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scribe_vault_org_doc_idx" ON "scribe_vault_records" ("organization_id", "document_id");
CREATE INDEX IF NOT EXISTS "scribe_vault_org_node_idx" ON "scribe_vault_records" ("organization_id", "node_id");
CREATE INDEX IF NOT EXISTS "scribe_vault_token_idx" ON "scribe_vault_records" ("token_id");
