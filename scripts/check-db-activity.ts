import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function checkActivity() {
  console.log("--- DB Activity Audit ---");
  try {
    const result: any = await db.execute(sql`
      SELECT pid, state, query, wait_event_type, wait_event, query_start 
      FROM pg_stat_activity 
      WHERE state IS NOT NULL AND query NOT LIKE '%pg_stat_activity%'
      ORDER BY query_start ASC;
    `);
    
    const rows = result.rows || [];
    console.log(`Found ${rows.length} active queries.`);
    for (const row of rows) {
      console.log(`PID: ${row.pid} | State: ${row.state} | Start: ${row.query_start}`);
      console.log(`Query: ${row.query.substring(0, 100)}...`);
      if (row.wait_event_type) {
        console.log(`Wait: ${row.wait_event_type}:${row.wait_event}`);
      }
      console.log('---');
    }
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

checkActivity().catch(err => {
  console.error(err);
  process.exit(1);
});
