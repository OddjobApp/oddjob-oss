import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function getRun91() {
  const result = await db.execute(sql`SELECT * FROM mission_runs WHERE id = 91`);
  console.log("Mission Run 91:", JSON.stringify(result.rows, null, 2));
}

getRun91().catch(console.error).finally(() => process.exit(0));

