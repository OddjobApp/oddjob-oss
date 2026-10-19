import { db } from "../server/database_service.js";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Ensuring xray_node_documentation table exists in database...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS xray_node_documentation (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER REFERENCES orgs(org_id),
      node_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      summary TEXT,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      tags JSONB DEFAULT '[]'::jsonb,
      author_id INTEGER,
      is_ai_generated BOOLEAN NOT NULL DEFAULT false,
      metadata JSONB DEFAULT '{}'::jsonb,
      knowledge_topic_id INTEGER,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS xray_node_doc_node_id_idx ON xray_node_documentation(node_id);
    CREATE INDEX IF NOT EXISTS xray_node_doc_org_node_idx ON xray_node_documentation(organization_id, node_id);
  `);

  console.log("✅ xray_node_documentation table and indexes created successfully!");
  process.exit(0);
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
