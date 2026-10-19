/**
 * Install the Sales Opportunity Pipeline cycle + workbench app into TECHHEAD7.
 *
 * Mirrors install-technical-research-techhead7.ts: resolves the org, reads the
 * cycle manifest, and runs the full Org Forge install (NOT skipAppLaunch — this
 * forges + launches the sales-opportunity-workbench app).
 *
 * Usage: npx tsx server/scripts/install-sales-pipeline-techhead7.ts
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
        const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
        if (!org) throw new Error("TECHHEAD7 not found");

        console.log(`Loading Sales Opportunity Pipeline cycle manifest for Org ${org.id}...`);
        const yamlPath = path.resolve(__dirname, "../cycles/sales-opportunity-pipeline.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log(`Installing Sales Opportunity Pipeline via Org Forge into Org ${org.id}...`);
        const result = await orgForgeService.installCycleApp(org.id, yamlContent);

        console.log("==========================================");
        console.log("Installation Successful!");
        console.log("Result:", JSON.stringify(result, null, 2));
        console.log("==========================================");

        process.exit(0);
    } catch (e) {
        console.error("Installation failed:", e);
        process.exit(1);
    }
}

install();
