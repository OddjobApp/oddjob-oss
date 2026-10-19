/**
 * Install Product Launch Cycle — One-command deployment
 *
 * Installs the Product Launch Cycle blueprint into a target org.
 * Creates agents, missions, app deployment, and seeds initial data.
 *
 * Usage: npx tsx server/scripts/install-product-launch.ts [orgName]
 */
import { db } from "../database_service.js";
import { orgs } from "@shared/schema/index.js";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function install() {
    const orgName = process.argv[2] || "TECHHEAD7";

    try {
        const [org] = await db.select().from(orgs).where(eq(orgs.name, orgName)).limit(1);
        if (!org) throw new Error(`Organization "${orgName}" not found`);

        console.log(`\n🚀 Installing Product Launch Cycle into "${orgName}" (Org #${org.id})...\n`);

        const yamlPath = path.resolve(__dirname, "../cycles/product-launch.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log("Loading cycle YAML...");
        const result = await orgForgeService.installCycleApp(org.id, yamlContent);

        console.log("\n══════════════════════════════════════════");
        console.log("  ✅ Product Launch Cycle Installed!");
        console.log("══════════════════════════════════════════");

        if ('installedApp' in result) {
            console.log(`  App: ${result.installedApp}`);
            console.log(`  Agents: ${result.agentsProvisioned}`);
            console.log(`  Missions: ${result.missionsProvisioned}`);
            console.log(`  Apps: ${result.appsProvisioned}`);
        }

        console.log("\n  Workbench Modules:");
        console.log("    • Launch Command Center");
        console.log("    • Market Research Workbench");
        console.log("    • Content Studio");
        console.log("    • Sales Enablement Hub");
        console.log("    • Feedback & Insights");
        console.log("\n══════════════════════════════════════════\n");

        process.exit(0);
    } catch (e: any) {
        console.error("❌ Install failed:", e.message);
        process.exit(1);
    }
}

install();
