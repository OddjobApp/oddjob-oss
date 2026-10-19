import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../../.env") });

import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function checkRuns() {
  const missionId = 91;
  const query = sql`
    SELECT id, name, status 
    FROM mission_runs 
    WHERE mission_id = ${missionId}
  `;

  try {
    const res = await db.execute(query);
    console.log(`Mission Runs for Mission ${missionId}:`, res.rows.length);
    if (res.rows.length > 0) {
      console.log('Run IDs:', res.rows.map(r => r.id));
    }
  } catch (e) {
    console.error("Error checking runs:", e);
  }
  process.exit(0);
}

checkRuns().catch(console.error);

