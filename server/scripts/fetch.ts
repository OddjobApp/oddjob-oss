import { db } from "../database_service.js";
import { appDeployments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
async function run() {
  const ds = await db.select().from(appDeployments).where(eq(appDeployments.organizationId, 257));
  console.log(ds.map(d => ({slug: d.publicSlug, status: d.status})));
  process.exit(0);
}
run();
