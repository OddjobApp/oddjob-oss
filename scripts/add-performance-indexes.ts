
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function addIndexes() {
  console.log("Starting Performance Index Hardening...");
  
  const queries = [
    // mission_runs
    { name: "mission_runs(organization_id)", sql: sql`CREATE INDEX IF NOT EXISTS mission_runs_org_id_idx ON mission_runs (organization_id)` },
    { name: "mission_runs(status)", sql: sql`CREATE INDEX IF NOT EXISTS mission_runs_status_idx ON mission_runs (status)` },
    
    // mission_step_assignments
    { name: "mission_step_assignments(organization_id)", sql: sql`CREATE INDEX IF NOT EXISTS mission_step_assign_org_idx ON mission_step_assignments (organization_id)` },
    { name: "mission_step_assignments(status)", sql: sql`CREATE INDEX IF NOT EXISTS mission_step_assign_status_idx ON mission_step_assignments (status)` },
    
    // jobs
    { name: "jobs(type)", sql: sql`CREATE INDEX IF NOT EXISTS jobs_type_idx ON jobs (type)` },
    { name: "jobs(is_active)", sql: sql`CREATE INDEX IF NOT EXISTS jobs_is_active_idx ON jobs (is_active)` },
    
    // ai_usage_logs (for cost lookups)
    { name: "ai_usage_logs(execution_id)", sql: sql`CREATE INDEX IF NOT EXISTS ai_usage_logs_exec_id_idx ON ai_usage_logs (execution_id)` }
  ];

  for (const query of queries) {
    try {
      console.log(`Adding index: ${query.name}...`);
      await db.execute(query.sql);
      console.log(`✓ Result: Success`);
    } catch (error: any) {
      if (error.message.includes("already exists")) {
        console.log(`- Result: Already exists (Skipped)`);
      } else {
        console.error(`✗ Result: Failed - ${error.message}`);
      }
    }
  }

  console.log("\nPerformance Index Hardening Completed.");
}

addIndexes().then(() => process.exit(0));
