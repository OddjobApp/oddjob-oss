import { db } from "../database_service.js";
import { orgs } from "@shared/schema/index.js";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function seedHybridSDLC() {
    try {
        console.log("Starting Hybrid SDLC Seed...");

        // 1. Ensure Org 1 exists (assuming it exists from base seed)
        const orgsList = await db.select().from(orgs).limit(1);
        if (orgsList.length === 0) {
            console.error("No organization found. Please run core seed first.");
            process.exit(1);
        }
        const orgId = orgsList[0].id;

        // 2. Load YAML and run Org Forge Ingestion
        console.log("Loading Cycle App YAML manifest...");
        const yamlPath = path.resolve(__dirname, "../cycles/hybrid-sdlc.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log("Installing Cycle App via Org Forge...");
        const result = await orgForgeService.installCycleApp(orgId, yamlContent) as any;
        
        console.log("==========================================");
        console.log("Seed Successful!");
        console.log("Installed App:", result.installedApp);
        console.log("Agents Provisioned:", result.agentsProvisioned);
        console.log("Missions Provisioned:", result.missionsProvisioned);
        console.log("Human Roles Provisioned:", result.humanRolesProvisioned || "N/A");
        console.log("Team topology and boundaries created via YAML configuration.");
        console.log("==========================================");
        
        process.exit(0);
    } catch (e) {
        console.error("Seed failed:", e);
        process.exit(1);
    }
}

seedHybridSDLC();
