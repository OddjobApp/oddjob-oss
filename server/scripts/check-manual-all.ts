import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function runManualAll() {
  const sqlStr = `
    SELECT * 
    FROM "mission_step_assignments" 
    INNER JOIN "mission_runs" ON "mission_step_assignments"."mission_run_id" = "mission_runs"."id" 
    LIMIT 1
  `;
  console.log("Running Manual SQL (SELECT *)...");
  try {
    const result = await db.execute(sql.raw(sqlStr));
    console.log("Success! Columns:", result.fields.map(f => f.name));
  } catch (e) {
    console.error("Manual SQL (ALL) Error:", e);
  }
}

runManualAll().catch(console.error).finally(() => process.exit(0));

