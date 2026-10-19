import "dotenv/config";
import { db } from "../../server/database_service.js";
import { apps, appDeployments, projectResources } from "../../shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { appForgeService } from "../../server/domain/apps/app-forge.service.js";
import { appRegistryService } from "../../server/domain/apps/app-registry.service.js";
import { projectService } from "../../server/domain/projects/core/project.service.js";

const ORG_ID = 473;
const PROJECT_ID = 44;
const TEST_SLUG = `acme-bi-metrics-${Date.now().toString(36).slice(-5)}`;

async function runVerification() {
  console.log("===============================================================");
  console.log("🚀 App Forge End-to-End Verification: Project Space & Arsenal");
  console.log("===============================================================");
  console.log(`Target Org ID:     ${ORG_ID} (Acme Corp)`);
  console.log(`Target Project ID: ${PROJECT_ID} (acme-corp-default)`);
  console.log(`Test App Slug:     ${TEST_SLUG}`);
  console.log("---------------------------------------------------------------\n");

  try {
    // 1. Trigger App Forge
    console.log("Step 1: Running App Forge (Assembly, Hardening, Ignition)...");
    const result = await appForgeService.forgeAppInternal("crud-app", {
      name: "Acme Business Intelligence",
      slug: TEST_SLUG,
      description: "Executive KPIs and Metrics Dashboard with real-time operational analytics",
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      skipToAssembly: true,
      oddjobMissionId: 0,
      blackboard: {
        target_collection: "kpi_metrics",
        entity_singular: "Metric",
        columns: [
          { key: "metric_name", label: "Metric", type: "text" },
          { key: "value", label: "Value", type: "number" },
          { key: "status", label: "Status", type: "text" }
        ]
      }
    });

    console.log("Forge Execution Result:", {
      success: result.success,
      appId: result.appId,
      readiness: result.readiness?.ready ? "READY" : "WARN"
    });

    if (!result.success || !result.appId) {
      throw new Error(`App Forge did not return a successful result: ${JSON.stringify(result)}`);
    }

    const appId = result.appId;
    console.log(`\n✅ Forge succeeded! Forged App ID: ${appId}\n`);

    // 2. Validate apps table record
    console.log("Step 2: Checking database apps table record...");
    const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
    if (!app) throw new Error(`App ${appId} not found in database!`);
    console.log("  • Name:           ", app.name);
    console.log("  • Slug:           ", app.slug);
    console.log("  • Status:         ", app.status);
    console.log("  • Organization ID:", app.organizationId);
    console.log("  • Project ID:     ", app.projectId);

    if (app.status !== "active") {
      throw new Error(`Expected app.status to be 'active', got '${app.status}'`);
    }
    if (app.projectId !== PROJECT_ID) {
      throw new Error(`Expected app.projectId to be ${PROJECT_ID}, got '${app.projectId}'`);
    }
    if (app.organizationId !== ORG_ID) {
      throw new Error(`Expected app.organizationId to be ${ORG_ID}, got '${app.organizationId}'`);
    }
    console.log("  ✅ apps record verified.\n");

    // 3. Validate projectResources link
    console.log("Step 3: Checking project_resources junction link...");
    const [projResource] = await db.select().from(projectResources).where(
      and(
        eq(projectResources.projectId, PROJECT_ID),
        eq(projectResources.resourceType, "app"),
        eq(projectResources.resourceId, appId)
      )
    ).limit(1);

    if (!projResource) {
      throw new Error(`No project_resources link found for project ${PROJECT_ID} and app ${appId}!`);
    }
    console.log("  • Resource ID:  ", projResource.resourceId);
    console.log("  • Resource Type:", projResource.resourceType);
    console.log("  • Project ID:   ", projResource.projectId);
    console.log("  • Relation:     ", projResource.relation);
    console.log("  ✅ project_resources junction verified.\n");

    // 4. Validate Project Space Query (Project Space / Apps tab)
    console.log("Step 4: Testing Project Space query (projectService.listApps)...");
    const projectApps = await projectService.listApps({ organizationId: ORG_ID }, PROJECT_ID);
    const foundInProjectSpace = projectApps.find(a => a.id === appId);
    if (!foundInProjectSpace) {
      throw new Error(`App ${appId} not found in projectService.listApps for project ${PROJECT_ID}!`);
    }
    console.log("  • Found in Project Space:", foundInProjectSpace.name, `(${foundInProjectSpace.slug})`);
    console.log("  • Status in Project Space:", foundInProjectSpace.status);
    console.log("  ✅ Project Space / Apps visibility confirmed!\n");

    // 5. Validate App Arsenal Query (App Arsenal / Installed Apps tab)
    console.log("Step 5: Testing App Arsenal query (appRegistryService.listOrgDeployments)...");
    const orgDeployments = await appRegistryService.listOrgDeployments(ORG_ID);
    const foundInArsenal = orgDeployments.find((d: any) => d.app?.id === appId || d.deployment?.appId === appId);
    if (!foundInArsenal) {
      throw new Error(`App ${appId} not found in appRegistryService.listOrgDeployments for org ${ORG_ID}!`);
    }
    console.log("  • Deployment ID:  ", foundInArsenal.deployment.id);
    console.log("  • Deployment Slug:", foundInArsenal.deployment.publicSlug);
    console.log("  • Deploy Status:  ", foundInArsenal.deployment.status);
    console.log("  • Deploy Project: ", foundInArsenal.deployment.projectId);
    console.log("  ✅ App Arsenal / Installed Apps visibility confirmed!\n");

    console.log("===============================================================");
    console.log("🎉 VERIFICATION PASSED: Full App Forge Lifecycle Verified!");
    console.log("   • App Forge forged and completed the app lifecycle");
    console.log("   • App displays in Project Space / Apps");
    console.log("   • App displays in App Arsenal Installed Apps");
    console.log("===============================================================");

    process.exit(0);
  } catch (err: any) {
    console.error("\n❌ Verification FAILED:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runVerification();
