import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function getMission91() {
  const result = await db.execute(sql`SELECT * FROM missions WHERE id = 91`);
  console.log("Mission 91:", JSON.stringify(result.rows, null, 2));
}

getMission91().catch(console.error).finally(() => process.exit(0));

