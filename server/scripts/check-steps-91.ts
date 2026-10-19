import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function checkSteps91() {
  const result = await db.execute(sql`SELECT id, job_id, mission_id, run_id FROM agent_run_steps WHERE job_id = 91 LIMIT 10`);
  console.log("Job 91 Steps:", JSON.stringify(result.rows, null, 2));
}

checkSteps91().catch(console.error).finally(() => process.exit(0));

