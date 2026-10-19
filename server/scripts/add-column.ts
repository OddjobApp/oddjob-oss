import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../../.env") });

import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function addColumn() {
  console.log("Adding column context_core_url to mission_runs...");
  try {
    await db.execute(sql.raw('ALTER TABLE mission_runs ADD COLUMN IF NOT EXISTS context_core_url TEXT;'));
    console.log("Success!");
  } catch (e) {
    console.error("Error adding column:", e);
  }
  process.exit(0);
}

addColumn().catch(console.error);

