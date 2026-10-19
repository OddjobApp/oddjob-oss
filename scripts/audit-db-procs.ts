import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function auditProcesses() {
  console.log("--- DB Process Audit ---");
  try {
    const result: any = await db.execute(sql`
      SELECT application_name, count(*) as conn_count
      FROM pg_stat_activity
      GROUP BY application_name
      ORDER BY conn_count DESC;
    `);
    
    const rows = result.rows || [];
    for (const row of rows) {
      console.log(`${row.application_name || 'unknown'}: ${row.conn_count}`);
    }
    
    const detailed: any = await db.execute(sql`
      SELECT pid, application_name, client_addr, state, query
      FROM pg_stat_activity
      WHERE application_name IS NOT NULL
      LIMIT 20;
    `);
    
    console.log("\nTop 20 Detailed sessions:");
    for (const d of detailed.rows || []) {
       console.log(`PID: ${d.pid} | App: ${d.application_name} | State: ${d.state} | Query: ${d.query.substring(0, 50)}...`);
    }

  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

auditProcesses().catch(err => {
  console.error(err);
  process.exit(1);
});
