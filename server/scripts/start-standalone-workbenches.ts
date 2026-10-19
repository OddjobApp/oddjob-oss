/**
 * Start Standalone Workbenches — builds and launches each standalone workbench
 * as a separate container for TECHHEAD7 (org 291).
 */
import { db } from "../database_service.js";
import { apps, appDeployments } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { appRegistryService } from "../domain/apps/app-registry.service.js";

const ORG_ID = 291;
const WORKBENCH_SLUGS = [
  "pm-workbench-org291",
  "scrum-master-workbench-org291",
  "qa-workbench-org291",
  "ai-workforce-dashboard-org291",
  "stakeholder-workbench-org291",
  "product-launch-workbench-org291",
];

async function startWorkbenches() {
  console.log("Starting standalone workbenches for TECHHEAD7...\n");

  for (const slug of WORKBENCH_SLUGS) {
    const baseSlug = slug.replace("-org291", "");
    console.log(`Looking for app: ${baseSlug}...`);

    const [app] = await db.select().from(apps)
      .where(eq(apps.slug, slug))
      .limit(1);

    if (!app) {
      // Try without org suffix
      const [app2] = await db.select().from(apps)
        .where(eq(apps.slug, baseSlug))
        .limit(1);
      if (!app2) {
        console.log(`  ⚠️  App "${baseSlug}" not found in DB — skipping`);
        continue;
      }
      try {
        console.log(`  Starting ${app2.slug} (id: ${app2.id})...`);
        const result = await appRegistryService.startApp(app2.id, ORG_ID);
        console.log(`  ✅ Started on port ${result.port}`);
      } catch (e: any) {
        console.log(`  ❌ Failed: ${e.message}`);
      }
      continue;
    }

    try {
      console.log(`  Starting ${app.slug} (id: ${app.id})...`);
      const result = await appRegistryService.startApp(app.id, ORG_ID);
      console.log(`  ✅ Started on port ${result.port}`);
    } catch (e: any) {
      console.log(`  ❌ Failed: ${e.message}`);
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

startWorkbenches();
