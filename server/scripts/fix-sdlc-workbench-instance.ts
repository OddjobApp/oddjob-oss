/**
 * Fix the sdlc-workbench-org291 app instance record so the UI
 * recognizes it as running on port 10011.
 */
import { db } from "../database_service.js";
import { apps, appDeployments, appInstances } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function main() {
  const APP_ID = 431;
  const DEPLOYMENT_ID = 593;
  const PORT = 10011;
  const PM2_NAME = "oddjob-app-sdlc-workbench-org291-10011";

  // Remove any stale instances for this deployment
  await db.delete(appInstances).where(eq(appInstances.deploymentId, DEPLOYMENT_ID));

  // Create a fresh instance record
  const [inst] = await db.insert(appInstances).values({
    deploymentId: DEPLOYMENT_ID,
    port: PORT,
    status: "running",
    containerId: PM2_NAME,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();

  console.log(`Created instance #${inst.id} on port ${PORT}`);

  // Update the app's runtimeMetadata to reflect running state
  const [app] = await db.select({ runtimeMetadata: apps.runtimeMetadata })
    .from(apps).where(eq(apps.id, APP_ID)).limit(1);

  const meta = (app?.runtimeMetadata as any) || {};
  await db.update(apps).set({
    runtimeMetadata: {
      ...meta,
      status: "running",
      lastInstanceId: inst.id,
      assignedPort: PORT,
      launchedAt: new Date().toISOString(),
      stoppedAt: undefined,
    },
    updatedAt: new Date(),
  }).where(eq(apps.id, APP_ID));

  console.log(`Updated app 431 runtimeMetadata → running on port ${PORT}`);
  process.exit(0);
}
main();
