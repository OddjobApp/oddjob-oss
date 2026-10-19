import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function checkLocks() {
  console.log("--- DB Lock Audit ---");
  try {
    const result: any = await db.execute(sql`
      SELECT 
        COALESCE(blockingl.relation::regclass::text, blockingl.locktype) as locked_item,
        now() - blockeda.query_start AS waiting_duration,
        blockeda.pid AS blocked_pid,
        blockeda.query AS blocked_query,
        blockinga.pid AS blocking_pid,
        blockinga.query AS blocking_query
      FROM pg_catalog.pg_locks blockedl
      JOIN pg_catalog.pg_stat_activity blockeda ON blockedl.pid = blockeda.pid
      JOIN pg_catalog.pg_locks blockingl ON(
        (blockingl.transactionid=blockedl.transactionid OR
         blockingl.relation=blockedl.relation AND blockingl.locktype=blockedl.locktype) AND
         blockingl.pid != blockedl.pid)
      JOIN pg_catalog.pg_stat_activity blockinga ON blockingl.pid = blockinga.pid
      WHERE NOT blockedl.granted
      AND blockinga.datname = current_database();
    `);
    
    const rows = result.rows || [];
    console.log(`Found ${rows.length} blocked queries.`);
    for (const row of rows) {
      console.log(`Blocked PID: ${row.blocked_pid} | Waiting: ${row.waiting_duration}`);
      console.log(`Blocked Query: ${row.blocked_query.substring(0, 50)}...`);
      console.log(`Blocking PID: ${row.blocking_pid}`);
      console.log(`Blocking Query: ${row.blocking_query.substring(0, 50)}...`);
      console.log('---');
    }
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

checkLocks().catch(err => {
  console.error(err);
  process.exit(1);
});
