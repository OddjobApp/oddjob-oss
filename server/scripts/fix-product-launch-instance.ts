import { db } from "../database_service.js";
import { apps, appDeployments, appInstances } from "@shared/schema/index.js";
import { eq, like } from "drizzle-orm";

async function main() {
  // Find the product launch workbench app
  const [app] = await db.select().from(apps)
    .where(like(apps.slug, "%product-launch-workbench%"))
    .limit(1);

  if (!app) { console.log("App not found"); process.exit(1); }

  console.log(`Found app: ${app.name} (ID: ${app.id}, slug: ${app.slug})`);

  // Find or create deployment
  let [deployment] = await db.select().from(appDeployments)
    .where(eq(appDeployments.appId, app.id)).limit(1);

  if (!deployment) {
    [deployment] = await db.insert(appDeployments).values({
      appId: app.id,
      organizationId: 291,
      status: "active",
      isPublished: true,
      publicSlug: "product-launch-workbench",
    } as any).returning();
    console.log(`Created deployment #${deployment.id}`);
  }

  // Create instance
  await db.delete(appInstances).where(eq(appInstances.deploymentId, deployment.id));
  const [inst] = await db.insert(appInstances).values({
    deploymentId: deployment.id,
    port: 10013,
    status: "running",
    containerId: "oddjob-app-product-launch-org291-10013",
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();

  console.log(`Created instance #${inst.id} on port 10013`);

  // Update runtime metadata
  await db.update(apps).set({
    runtimeMetadata: {
      status: "running",
      lastInstanceId: inst.id,
      assignedPort: 10013,
      launchedAt: new Date().toISOString(),
      isSharedServer: true,
    },
    updatedAt: new Date(),
  }).where(eq(apps.id, app.id));

  console.log("✅ App marked as running on port 10013");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
