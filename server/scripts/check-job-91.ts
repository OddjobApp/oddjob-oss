import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function checkJob91() {
  const result = await db.execute(sql`SELECT * FROM mission_members WHERE entity_id = 91 AND entity_type = 'job'`);
  console.log("Job 91 Memberships:", JSON.stringify(result.rows, null, 2));
}

checkJob91().catch(console.error).finally(() => process.exit(0));

