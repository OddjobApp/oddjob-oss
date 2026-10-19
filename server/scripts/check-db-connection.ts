import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function checkDb() {
  const result = await db.execute(sql`SELECT id, job_id, mission_id FROM agent_run_steps LIMIT 5`);
  console.log("Sample Rows:", JSON.stringify(result.rows, null, 2));
}

checkDb().catch(console.error).finally(() => process.exit(0));

