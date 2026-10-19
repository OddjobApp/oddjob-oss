import "dotenv/config";
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function createMissionAttachmentTables() {
    console.log("Creating mission_rag_assets table...");
    await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mission_rag_assets (
      id SERIAL PRIMARY KEY,
      mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      rag_asset_id INTEGER NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'reference',
      added_by TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
    console.log("✅ mission_rag_assets created");

    console.log("Creating mission_document_templates table...");
    await db.execute(sql`
    CREATE TABLE IF NOT EXISTS mission_document_templates (
      id SERIAL PRIMARY KEY,
      mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      document_template_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'output_standard',
      added_by TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
    console.log("✅ mission_document_templates created");

    console.log("Done!");
    process.exit(0);
}

createMissionAttachmentTables().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
});
