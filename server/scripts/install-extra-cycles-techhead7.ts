/**
 * Install Service Dispatch Pipeline and Asset Discovery Pipeline for TECHHEAD7 (org id=291)
 *
 * Usage: npx tsx server/scripts/install-extra-cycles-techhead7.ts
 */
import { db } from "../database_service.js";
import { orgs, operationalCycles } from "@shared/schema/index.js";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORG_ID = Number(process.env.ORG_ID || process.argv[2] || 291);

async function install() {
    try {
        const [org] = await db.select().from(orgs).where(eq(orgs.id, ORG_ID)).limit(1);
        if (!org) throw new Error(`TECHHEAD7 org (id=${ORG_ID}) not found in database`);

        console.log(`\n🔧 Installing extra cycles for "${org.name}" (ID: ${org.id})...\n`);

        const cyclesToInstall = [
            "service-dispatch-pipeline.cycle.yaml",
            "asset-discovery.cycle.yaml"
        ];

        for (const filename of cyclesToInstall) {
            const yamlPath = path.resolve(__dirname, `../cycles/${filename}`);
            const yamlContent = await fs.readFile(yamlPath, "utf-8");

            console.log(`  Loading cycle YAML from: ${yamlPath}`);
            console.log(`  Installing via Org Forge...`);

            const result = await orgForgeService.installCycleApp(org.id, yamlContent);
            console.log(`  ✅ Installed ${filename}:`, JSON.stringify(result, null, 2));
        }

        console.log("\n--- CURRENT OPERATIONAL CYCLES ---");
        const cyclesList = await db.select().from(operationalCycles).where(eq(operationalCycles.organizationId, ORG_ID));
        for (const c of cyclesList) {
            console.log(`ID: ${c.id} | Name: ${c.name} | Status: ${c.status}`);
        }

        console.log("\n  ══════════════════════════════════════════");
        console.log("  ✅ Extra Cycles Installation Complete!");
        console.log("  ══════════════════════════════════════════\n");
        process.exit(0);
    } catch (e) {
        console.error("\n❌ Installation failed:", e);
        process.exit(1);
    }
}

install();
