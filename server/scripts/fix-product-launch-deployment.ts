import { db } from "../database_service.js";
import { appDeployments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  // Fix deployment 598 status from "failed" to "active"
  await db.update(appDeployments).set({
    status: "active",
    updatedAt: new Date(),
  }).where(eq(appDeployments.id, 598));

  console.log("✅ Deployment #598 status updated to 'active'");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
