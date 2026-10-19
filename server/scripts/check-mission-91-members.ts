import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function checkMission91() {
  const result = await db.execute(sql`SELECT * FROM mission_members WHERE mission_id = 91`);
  console.log("Mission 91 Members:", JSON.stringify(result.rows, null, 2));
}

checkMission91().catch(console.error).finally(() => process.exit(0));

