/**
 * Install Agent Performance & Training cycle for TECHHEAD7
 *
 * Provisions the agent-training.cycle.yaml into the TECHHEAD7 org,
 * creating the AI Evaluator and AI Trainer agents, the 6 training
 * missions, and the Agent Performance & Training Portal workbench app.
 *
 * Usage: npx tsx server/scripts/install-agent-training-techhead7.ts
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
    try {
        // Find TECHHEAD7 org by name, or fall back to default first org
        let [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
        if (!org) {
            [org] = await db.select().from(orgs).limit(1);
        }
        if (!org) throw new Error("No organization found in database.");

        console.log(`\n🧠 Installing Agent Performance & Training cycle for "${org.name}" (ID: ${org.id})...\n`);

        const yamlPath = path.resolve(__dirname, "../cycles/agent-training.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log("Loading cycle YAML from:", yamlPath);
        console.log(`Installing Cycle App via Org Forge into Org ${org.id}...`);

        const result = await orgForgeService.installCycleApp(org.id, yamlContent) as any;

        console.log("\n══════════════════════════════════════════");
        console.log("✅ Agent Training Cycle Installation Successful!");
        console.log("══════════════════════════════════════════");
        if (result?.installedApp) {
            console.log("App Installed:       ", result.installedApp?.name || result.installedApp);
        }
        if (result?.agentsProvisioned !== undefined) {
            console.log("Agents Provisioned:  ", result.agentsProvisioned);
        }
        if (result?.missionsProvisioned !== undefined) {
            console.log("Missions Provisioned:", result.missionsProvisioned);
        }
        console.log("Full result:", JSON.stringify(result, null, 2));
        console.log("══════════════════════════════════════════\n");

        process.exit(0);
    } catch (e: any) {
        console.error("\n❌ Installation failed:", e?.message || e);
        console.error(e);
        process.exit(1);
    }
}

install();
