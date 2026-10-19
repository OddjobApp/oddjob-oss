import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function runManual() {
  const sqlStr = `
    SELECT "mission_step_assignments"."id", "mission_step_assignments"."mission_run_id" 
    FROM "mission_step_assignments" 
    INNER JOIN "mission_runs" ON "mission_step_assignments"."mission_run_id" = "mission_runs"."id" 
    WHERE "mission_runs"."mission_id" = 91
  `;
  console.log("Running Manual SQL...");
  try {
    const result = await db.execute(sql.raw(sqlStr));
    console.log("Success! Result length:", result.rows.length);
  } catch (e) {
    console.error("Manual SQL Error:", e);
  }
}

runManual().catch(console.error).finally(() => process.exit(0));

