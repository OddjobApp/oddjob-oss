import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function checkCols() {
  const result = await db.execute(sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'mission_step_assignments'
  `);
  console.log("Columns in mission_step_assignments:", result.rows.map(r => r.column_name));
}

checkCols().catch(console.error).finally(() => process.exit(0));

