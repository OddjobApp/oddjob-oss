ALTER TABLE IF EXISTS xray_node_documentation
  ADD COLUMN IF NOT EXISTS knowledge_topic_id INTEGER;
--> statement-breakpoint
ALTER TABLE IF EXISTS xray_node_documentation
  ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;
--> statement-breakpoint
ALTER TABLE IF EXISTS xray_node_documentation
  ADD COLUMN IF NOT EXISTS documentation_status TEXT NOT NULL DEFAULT 'up-to-date';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS xray_node_doc_changes (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES orgs(org_id),
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'change',
  previous_fingerprint TEXT,
  new_fingerprint TEXT NOT NULL,
  explanation TEXT,
  added_lines INTEGER DEFAULT 0,
  removed_lines INTEGER DEFAULT 0,
  diff TEXT DEFAULT '',
  author_id INTEGER,
  is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS xray_node_doc_changes_node_id_idx
  ON xray_node_doc_changes (node_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS xray_node_doc_changes_org_node_idx
  ON xray_node_doc_changes (organization_id, node_id);
