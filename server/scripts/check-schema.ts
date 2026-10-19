import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function checkSchema() {
  const result = await db.execute(sql`
    SELECT table_schema, table_name, column_name 
    FROM information_schema.columns 
    WHERE table_name = 'mission_step_assignments'
  `);
  console.log("Columns:", JSON.stringify(result.rows, null, 2));
}

checkSchema().catch(console.error).finally(() => process.exit(0));

