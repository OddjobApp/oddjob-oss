import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function getBadRecords() {
  const tables = ['agent_run_steps', 'agent_chat_messages'];
  
  for (const table of tables) {
    console.log(`Checking table: ${table}`);
    const result = await db.execute(sql.raw(`SELECT id, job_id, mission_id FROM ${table} WHERE mission_id = 91`));
    if (result.rows.length > 0) {
      console.log(`[FOUND] ${table}:`, JSON.stringify(result.rows, null, 2));
    } else {
      console.log(`[NOT FOUND] ${table}`);
    }
  }
}

getBadRecords().catch(console.error).finally(() => process.exit(0));

