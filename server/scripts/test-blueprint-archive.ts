import "dotenv/config";
import { db } from "../db/index.js";
import { orgs } from "@shared/schema/index.js";
import { OrgForgeService } from "../domain/org/core/org-forge.service.js";
import { createLogger } from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";

const logger = createLogger("TestBlueprintArchive");

async function run() {
    try {
        const zipPath = path.resolve(process.cwd(), "storage/blueprints/hybrid-sdlc.cycle.zip");
        logger.info(`Reading archive from ${zipPath}...`);
        
        const archiveBuffer = await fs.readFile(zipPath);

        logger.info("Creating a fresh Org to test hydration...");
        const orgName = `Archive Test Org ${Date.now()}`;
        const [org] = await db.insert(orgs).values({
            name: orgName,
            subscriptionPlan: "enterprise"
        }).returning();

        logger.info(`✅ Created Org: ${org.name} (ID: ${org.id})`);

        logger.info("Instantiating OrgForgeService and passing archive buffer...");
        const forge = new OrgForgeService();
        
        const result = await forge.installCycleFromArchive(org.id, archiveBuffer) as any;
        
        logger.info("==========================================");
        logger.info("✅ Hydration from Archive Completed Successfully!");
        logger.info("==========================================");
        logger.info(`Summary:`);
        logger.info(`  Missions: ${result.missionsProvisioned}`);
        logger.info(`  Agents: ${result.agentsProvisioned}`);
        logger.info(`  Pipelines: ${result.pipelinesProvisioned}`);
        logger.info(`  Apps: ${result.appsProvisioned}`);
        logger.info(`  Templates: ${result.templatesProvisioned}`);
        logger.info("==========================================");
        
        if (result.warnings && result.warnings.length > 0) {
            logger.warn("Warnings generated during install:");
            result.warnings.forEach((w: string) => logger.warn(`  - ${w}`));
        }

        process.exit(0);
    } catch (err: any) {
        logger.error(`Test failed: ${err.message}`);
        if (err.stack) {
            logger.error(err.stack);
        }
        process.exit(1);
    }
}

run();
