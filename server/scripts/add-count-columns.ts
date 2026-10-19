import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../../.env") });

import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Adding columns entity_count and relationship_count to mission_runs...");
  try {
    await db.execute(sql.raw('ALTER TABLE mission_runs ADD COLUMN IF NOT EXISTS entity_count INTEGER;'));
    await db.execute(sql.raw('ALTER TABLE mission_runs ADD COLUMN IF NOT EXISTS relationship_count INTEGER;'));
    console.log("Success!");
  } catch (e) {
    console.error("Error adding columns:", e);
  }
  process.exit(0);
}

migrate().catch(console.error);

