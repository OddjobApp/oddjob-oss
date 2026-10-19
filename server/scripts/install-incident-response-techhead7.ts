/**
 * Install Incident Response Chain for TECHHEAD7 (org id=291)
 *
 * Loads the cycle YAML and provisions it via orgForgeService.installCycleApp.
 *
 * Usage: npx tsx server/scripts/install-incident-response-techhead7.ts
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
        // Verify TECHHEAD7 org exists with id=291
        const [org] = await db.select().from(orgs).where(eq(orgs.id, 291)).limit(1);
        if (!org) throw new Error("TECHHEAD7 org (id=291) not found in database");

        console.log(`\n🚨 Installing Incident Response Chain for "${org.name}" (ID: ${org.id})...\n`);

        const yamlPath = path.resolve(__dirname, "../cycles/incident-response-chain.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log("Loading cycle YAML from:", yamlPath);
        console.log(`Installing Cycle App via Org Forge into Org ${org.id}...`);

        const result = await orgForgeService.installCycleApp(org.id, yamlContent);

        console.log("\n══════════════════════════════════════════");
        console.log("✅ Installation Successful!");
        console.log("══════════════════════════════════════════");
        console.log("Result:", JSON.stringify(result, null, 2));
        console.log("══════════════════════════════════════════\n");

        process.exit(0);
    } catch (e) {
        console.error("\n❌ Installation failed:", e);
        process.exit(1);
    }
}

install();
