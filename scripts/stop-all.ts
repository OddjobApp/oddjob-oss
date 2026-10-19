
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function stopAll() {
  console.log("Starting Emergency Stop of all active jobs and missions...");
  
  try {
    // 1. Deactivate all configured Jobs
    console.log("Deactivating configured activities (jobs table)...");
    const resJobs = await db.execute(sql`
      UPDATE jobs 
      SET is_active = false 
      WHERE is_active = true
      RETURNING id;
    `);
    console.log(`✓ Deactivated ${resJobs.rows.length} active jobs.`);

    // 2. Stop all running Mission Runs
    console.log("Terminating active mission runs...");
    const resMissions = await db.execute(sql`
      UPDATE mission_runs 
      SET status = 'failed', failure_reason = 'Stopped by user' 
      WHERE status = 'active'
      RETURNING id;
    `);
    console.log(`✓ Terminated ${resMissions.rows.length} active mission runs.`);

    // 3. Stop all running Pipeline Executions
    console.log("Terminating running pipeline executions...");
    const resPipelines = await db.execute(sql`
      UPDATE pipeline_executions 
      SET status = 'failed', error = 'Stopped by user' 
      WHERE status = 'running'
      RETURNING id;
    `);
    console.log(`✓ Terminated ${resPipelines.rows.length} running pipeline executions.`);

    console.log("\nEmergency Stop Completed Successfully.");
  } catch (error) {
    console.error("Emergency Stop Failed:", error);
    process.exit(1);
  }
}

stopAll().then(() => process.exit(0));
