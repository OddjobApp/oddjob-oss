import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function checkRuns() {
  const result = await db.execute(sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'mission_runs'
  `);
  console.log("Columns in mission_runs:", result.rows.map(r => r.column_name));
}

checkRuns().catch(console.error).finally(() => process.exit(0));

