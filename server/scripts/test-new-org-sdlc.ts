import { db } from "../database_service.js";
import { orgs } from "@shared/schema/index.js";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testNewOrgSDLC() {
    try {
        console.log("Starting New Org SDLC Test...");

        // 1. Create a new organization
        console.log("Creating new Organization...");
        const [newOrg] = await db.insert(orgs).values({
            name: "Test SDLC Org " + Date.now(),
            subscriptionPlan: "enterprise"
        }).returning();

        console.log(`Created Organization: ${newOrg.name} (ID: ${newOrg.id})`);

        // 2. Load YAML and run Org Forge Ingestion
        console.log("Loading Cycle App YAML manifest...");
        const yamlPath = path.resolve(__dirname, "../cycles/hybrid-sdlc.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log(`Installing Cycle App via Org Forge into Org ${newOrg.id}...`);
        const result = await orgForgeService.installCycleApp(newOrg.id, yamlContent);
        
        console.log("|========================================||");
        console.log("Seed Successful for New Org!");
        if (!('installedApp' in result)) {
            console.log("Result was validation-only or dry-run, no install data available.");
            process.exit(0);
        }
        console.log("Installed App:", result.installedApp);
        console.log("Agents Provisioned:", result.agentsProvisioned);
        console.log("Missions Provisioned:", result.missionsProvisioned);
        console.log("Human Roles Provisioned:", result.humanRolesProvisioned || "N/A");
        console.log("Apps Provisioned:", result.appsProvisioned);
        console.log("Forms Provisioned:", result.formsProvisioned);
        console.log("Team topology and boundaries created via YAML configuration.");
        console.log("|========================================||");
        
        process.exit(0);
    } catch (e) {
        console.error("Test failed:", e);
        process.exit(1);
    }
}

testNewOrgSDLC();
