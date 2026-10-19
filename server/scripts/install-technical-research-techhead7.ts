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
        
        console.log(`Loading Technical Research Cycle App YAML manifest for Org ${org.id}...`);
        const yamlPath = path.resolve(__dirname, "../cycles/technical-research.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log(`Installing Technical Research Cycle App via Org Forge into Org ${org.id}...`);
        const result = await orgForgeService.installCycleApp(org.id, yamlContent);
        
        console.log("==========================================");
        console.log("Installation Successful!");
        console.log("Result:", result);
        console.log("==========================================");
        
        process.exit(0);
    } catch (e) {
        console.error("Installation failed:", e);
        process.exit(1);
    }
}

install();
