/**
 * Clean reinstall of Product Launch Cycle into TECHHEAD7.
 * Removes the existing cycle first, then does a fresh install.
 */
import { db } from "../database_service.js";
import { orgs, operationalCycles, cycleBlueprints, apps, appDeployments } from "@shared/schema/index.js";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import { eq, and, like } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
    if (!org) throw new Error("TECHHEAD7 not found");

    console.log(`\n🧹 Cleaning existing Product Launch Cycle from org ${org.id}...\n`);

    // Delete existing cycle
    const existingCycles = await db.select().from(operationalCycles)
        .where(and(eq(operationalCycles.organizationId, org.id), like(operationalCycles.name, "%Product Launch%")));

    for (const cycle of existingCycles) {
        await db.delete(cycleBlueprints).where(eq(cycleBlueprints.cycleId, cycle.id));
        await db.delete(operationalCycles).where(eq(operationalCycles.id, cycle.id));
        console.log(`  Deleted cycle: "${cycle.name}" (ID: ${cycle.id})`);
    }

    // Delete existing product-launch app if any
    const existingApps = await db.select().from(apps)
        .where(like(apps.slug, "%product-launch-workbench%"));
    for (const app of existingApps) {
        await db.delete(appDeployments).where(eq(appDeployments.appId, app.id));
        await db.delete(apps).where(eq(apps.id, app.id));
        console.log(`  Deleted app: "${app.name}" (slug: ${app.slug})`);
    }

    // Clean workspace
    const workspaceRoot = path.resolve(__dirname, "../../storage/forge-workspace");
    const workspacePath = path.join(workspaceRoot, `product-launch-workbench-org${org.id}`);
    await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => {});
    console.log(`  Cleaned workspace: ${workspacePath}`);

    console.log(`\n🚀 Fresh install of Product Launch Cycle...\n`);

    const yamlPath = path.resolve(__dirname, "../cycles/product-launch.cycle.yaml");
    const yamlContent = await fs.readFile(yamlPath, "utf-8");

    const result = await orgForgeService.installCycleApp(org.id, yamlContent);

    console.log("\n══════════════════════════════════════════");
    console.log("  ✅ Product Launch Cycle Installed!");
    console.log("══════════════════════════════════════════");
    if ('installedApp' in result) {
        console.log(`  App: ${result.installedApp}`);
        console.log(`  Agents: ${result.agentsProvisioned}`);
        console.log(`  Missions: ${result.missionsProvisioned}`);
        console.log(`  Apps: ${result.appsProvisioned}`);
        console.log(`  Running: ${result.appsRunning}`);
        console.log(`  Queued: ${result.appsQueued}`);
        if (result.appLaunchDetails?.length) {
            console.log(`  App Details:`);
            for (const d of result.appLaunchDetails) {
                const slug = 'slug' in d ? d.slug : "(unknown)";
                console.log(`    - ${slug}: ${d.status}${d.error ? ` (${d.error})` : ""}`);
            }
        }
    }
    console.log("══════════════════════════════════════════\n");
    process.exit(0);
}

main().catch(err => { console.error("Failed:", err.message); process.exit(1); });
