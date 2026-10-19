/**
 * Fix the Product Launch Workbench app's runtimeMetadata to include
 * cycleApp data so the Cycle Manager shows workbench tabs.
 */
import { db } from "../database_service.js";
import { apps } from "@shared/schema/index.js";
import { eq, like } from "drizzle-orm";

async function main() {
  const [app] = await db.select().from(apps)
    .where(like(apps.slug, "%product-launch-workbench-org291%"))
    .limit(1);

  if (!app) { console.log("App not found"); process.exit(1); }

  const existingMeta = (app.runtimeMetadata as any) || {};

  const cycleApp = {
    source: "cycle_app",
    blueprint: "product-launch-workbench",
    sourceAppId: "product-launch-workbench",
    sourceAppName: "Product Launch Workbench",
    sourceCycleName: "Product Launch Cycle",
    interactionModel: "shared-server",
    dependentMissionIds: [
      "mission-0-launch-brief",
      "mission-1-gtm-strategy",
      "mission-2-content-creation",
      "mission-3-sales-enablement",
      "mission-4-beta-program",
      "mission-5-launch-execution",
      "mission-6-post-launch",
      "mission-7-ongoing-optimization",
    ],
    editableInAppBuilder: true,
    workbenchModules: [
      { id: "launch-command-center", name: "Launch Command Center", routePath: "launch-command-center", editable: true, embedMode: "cycle-modal", description: "Central dashboard showing launch readiness score, timeline progress, cross-functional status, and real-time metrics.", dependentMissions: ["mission-0-launch-brief", "mission-1-gtm-strategy", "mission-2-content-creation", "mission-3-sales-enablement", "mission-4-beta-program", "mission-5-launch-execution"] },
      { id: "market-research-workbench", name: "Market Research Workbench", routePath: "market-research", editable: true, embedMode: "cycle-modal", description: "Interactive workspace for competitive analysis, persona validation, market sizing, and research synthesis.", dependentMissions: ["mission-0-launch-brief"] },
      { id: "content-studio", name: "Content Studio", routePath: "content-studio", editable: true, embedMode: "cycle-modal", description: "Content creation workspace with AI-assisted copywriting, asset tracking, approval workflows, and publishing.", dependentMissions: ["mission-2-content-creation"] },
      { id: "sales-enablement-hub", name: "Sales Enablement Hub", routePath: "sales-enablement", editable: true, embedMode: "cycle-modal", description: "Sales readiness center with playbooks, battle cards, demo scripts, training materials, and certification tracking.", dependentMissions: ["mission-3-sales-enablement"] },
      { id: "feedback-insights", name: "Feedback & Insights", routePath: "feedback-insights", editable: true, embedMode: "cycle-modal", description: "Customer feedback aggregation, sentiment analysis, NPS tracking, and iteration priority recommendations.", dependentMissions: ["mission-4-beta-program", "mission-6-post-launch"] },
    ],
  };

  await db.update(apps).set({
    runtimeMetadata: {
      ...existingMeta,
      cycleApp,
      isSharedServer: true,
      workbenchModules: cycleApp.workbenchModules,
    },
    updatedAt: new Date(),
  }).where(eq(apps.id, app.id));

  console.log(`✅ Updated app ${app.id} (${app.slug}) with cycleApp metadata`);
  console.log(`   Workbench modules: ${cycleApp.workbenchModules.length}`);
  console.log(`   Dependent missions: ${cycleApp.dependentMissionIds.length}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
