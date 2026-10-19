
import { appForgeService } from "../app-forge.service.js";
import { createLogger } from "@server/utils/logger.js";
import "../../knowledge/index.js"; // Register knowledge pod

const logger = createLogger("ForgeDryRun");

async function main() {
    logger.info("Starting Mission Supervisor Forge Dry-Run...");
    
    const options = {
        name: "Mission Control 2026",
        slug: "mission-control-2026",
        description: "Industrial mission monitoring app with real-time logs and pipeline controls. Must use StatusTimeline block.",
        organizationId: 1,
        oddjobMissionId: 2026, // Mock mission ID
        blackboard: {
            target_collection: "missions",
            theme: "dark-glass"
        }
    };

    try {
        const result = await appForgeService.forgeAppInternal("mission-supervisor", options as any, "dry-run-job-id");
        logger.info("Forge result:", result);
        process.exit(0);
    } catch (err: any) {
        logger.error("Forge failed:", err.message);
        process.exit(1);
    }
}

main();
