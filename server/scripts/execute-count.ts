import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../../.env") });

import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function countAssignments() {
  const missionId = 91;
  const query = sql`
    SELECT count(*) 
    FROM mission_step_assignments msa
    INNER JOIN mission_runs mr ON msa.mission_run_id = mr.id
    WHERE mr.mission_id = ${missionId}
  `;
  
  const queryCompleted = sql`
    SELECT count(*) 
    FROM mission_step_assignments msa
    INNER JOIN mission_runs mr ON msa.mission_run_id = mr.id
    WHERE mr.mission_id = ${missionId} AND msa.status = 'completed'
  `;

  try {
    const total = await db.execute(query);
    const completed = await db.execute(queryCompleted);
    console.log(`Total assignments for Mission ${missionId}:`, total.rows[0].count);
    console.log(`Completed assignments for Mission ${missionId}:`, completed.rows[0].count);
  } catch (e) {
    console.error("Error counting assignments:", e);
  }
  process.exit(0);
}

countAssignments().catch(console.error);

