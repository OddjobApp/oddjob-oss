import { db } from "../database_service.js";
import { apps, appDeployments, appInstances } from "@shared/schema/index.js";
import { eq, like } from "drizzle-orm";

async function main() {
  const appRows = await db.select().from(apps).where(like(apps.slug, "%product-launch%"));
  console.log(`\n=== Product Launch Apps (${appRows.length}) ===\n`);
  for (const app of appRows) {
    console.log(`  ID: ${app.id}, Slug: ${app.slug}, Name: ${app.name}`);
    console.log(`  OrgId: ${app.organizationId}, IsPublic: ${app.isPublic}`);
    console.log(`  Blueprint: ${app.blueprint}`);
    const meta = app.runtimeMetadata as any;
    console.log(`  Status: ${meta?.status}, Port: ${meta?.assignedPort}`);
    console.log(`  Has cycleApp: ${!!meta?.cycleApp}`);
    console.log(`  cycleApp.interactionModel: ${meta?.cycleApp?.interactionModel}`);
    console.log(`  cycleApp.workbenchModules: ${meta?.cycleApp?.workbenchModules?.length || 0}`);
    console.log(`  isSharedServer: ${meta?.isSharedServer}`);

    const deps = await db.select().from(appDeployments).where(eq(appDeployments.appId, app.id));
    console.log(`  Deployments: ${deps.length}`);
    for (const dep of deps) {
      console.log(`    Dep #${dep.id}: org=${dep.organizationId}, status=${dep.status}, published=${dep.isPublished}, publicSlug=${dep.publicSlug}`);
      const instances = await db.select().from(appInstances).where(eq(appInstances.deploymentId, dep.id));
      for (const inst of instances) {
        console.log(`      Instance #${inst.id}: port=${inst.port}, status=${inst.status}`);
      }
    }
    console.log("");
  }
  process.exit(0);
}
main();
