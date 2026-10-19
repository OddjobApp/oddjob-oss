import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function check() {
  const result = await db.execute(sql`SELECT COUNT(*) FROM agent_run_steps WHERE job_id = 91 AND mission_id = 91`);
  console.log("Count of steps with jobId 91 and missionId 91:", result.rows[0].count);
}

check().catch(console.error).finally(() => process.exit(0));

