import "dotenv/config";
import { db } from "../db/index.js";
import { missions } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const [mission] = await db.select().from(missions).where(eq(missions.id, 33)).limit(1);
  console.log("BLACKBOARD:");
  console.log(JSON.stringify(mission.blackboard, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

