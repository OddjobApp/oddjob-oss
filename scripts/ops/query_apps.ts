import { db } from "../../server/database_service.js";
import { apps } from "../../shared/schema/index.js";

async function run() {
  const allApps = await db.select().from(apps);
  console.log("All apps in DB:");
  allApps.forEach(a => console.log(`- ${a.slug} (isPublic: ${a.isPublic})`));
  process.exit(0);
}
run();
