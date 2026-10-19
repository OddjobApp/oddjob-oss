import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
async function run() {
  const as = await db.select().from(apps).where(eq(apps.organizationId, 257));
  console.log(as.map(a => a.slug));
  process.exit(0);
}
run();
