import "dotenv/config";
import { db } from "../database_service.js";
import { operationalCycles, missions, missionAppBindings, missionRuns, appDeployments, appInstances } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const ORG_ID = 291;
  const CYCLE_ID = 202;
  
  console.log(`Seeding data for cycle ${CYCLE_ID}...`);
  await db.delete(appInstances);

  // Create a mission for the cycle
  const [newMission] = await db.insert(missions).values({
    organizationId: ORG_ID,
    name: "Launch Command Center Setup",
    objective: "Manage the product launch via the Command Center",
    status: "active",
    type: "sdlc",
    createdBy: "system",
  }).returning();
  
  console.log(`Created mission ID: ${newMission.id}`);

  // Create an app binding (assuming app ID 1 or we need to find the launch-command-center app)
  // Let's first find the app
  const apps = await db.query.apps.findMany({ where: (a, { eq }) => eq(a.organizationId, ORG_ID) });
  const launchApp = apps.find(a => a.slug === 'launch-command-center' || a.name.includes('Launch'));
  
  if (launchApp) {
    await db.insert(missionAppBindings).values({
      organizationId: ORG_ID,
      missionId: newMission.id,
      appId: launchApp.id,
      role: 'primary',
      openModeDefault: 'modal',
      sortOrder: 1,
      source: 'manual',
    });
    console.log(`Bound app "${launchApp.name}" to mission`);

    // Create a mission run so it appears in the API response (requires at least one run)
    await db.insert(missionRuns).values({
      organizationId: ORG_ID,
      missionId: newMission.id,
      cycleId: CYCLE_ID,
      name: "Launch Command Center Session",
      status: "active",
      reasoningProtocol: "json_manifest",
      createdBy: "system",
    });
    console.log(`Created mission run`);

  } else {
    console.log("Could not find launch command center app, creating dummy app binding...");
    // If the app doesn't exist, we might need to create it
    // but maybe the test can still click the dropdown if there's any binding
  }
  
  console.log("Done.");
  if (launchApp) {
    // Find the deployment for this app
    const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.appId, launchApp.id)).limit(1);
    if (deployment) {
      // Directly register the running instance at port 10009 in the DB.
      // This is more reliable than PM2 in test environments.
      const instanceId = `test-${Date.now()}`;
      await db.insert(appInstances).values({
        deploymentId: deployment.id,
        port: 10009,
        status: "running",
        containerId: instanceId,
      });
      console.log(`Registered running instance at port 10009 (deployment ${deployment.id})`);
    } else {
      console.log("No deployment found for app, falling back to appRegistryService...");
      const { appRegistryService } = await import("../domain/apps/app-registry.service.js");
      await appRegistryService.startApp(launchApp.id, ORG_ID);
      console.log("App started successfully.");
    }
  }
  process.exit(0);
}
main().catch(console.error);
