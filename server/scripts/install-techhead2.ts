import { db } from "../database_service.js";
import { orgs } from "@shared/schema/index.js";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyToTechHead2() {
    try {
        const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD2")).limit(1);
        if (!org) throw new Error("TECHHEAD2 not found");
        
        console.log(`Loading Cycle App YAML manifest for Org ${org.id}...`);
        const yamlPath = path.resolve(__dirname, "../cycles/hybrid-sdlc.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log(`Installing Cycle App via Org Forge into Org ${org.id}...`);
        const result = await orgForgeService.installCycleApp(org.id, yamlContent);
        
        console.log("==========================================");
        console.log("Seed Successful!");
        if (!('installedApp' in result)) {
            console.log("Result was validation-only or dry-run, no install data available.");
            process.exit(0);
        }
        console.log("Installed App:", result.installedApp);
        console.log("Agents Provisioned:", result.agentsProvisioned);
        console.log("Missions Provisioned:", result.missionsProvisioned);
        console.log("Apps Provisioned:", result.appsProvisioned);
        console.log("==========================================");
        
        process.exit(0);
    } catch (e) {
        console.error("Test failed:", e);
        process.exit(1);
    }
}

applyToTechHead2();
