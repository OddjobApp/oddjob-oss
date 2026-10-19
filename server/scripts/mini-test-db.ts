
import { db } from "../database_service.js";
import { missions } from "@shared/schema/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("MiniTest");

async function run() {
    logger.info("Testing DB connectivity and missions table...");
    try {
        const results = await db.select().from(missions).limit(1);
        if (results.length > 0) {
            const m = results[0];
            logger.info(`Found Mission: ID=${m.id}, Name=${m.name}, OrgID=${m.organizationId}`);
        } else {
            logger.warn("No missions found in DB.");
        }
    } catch (err) {
        logger.error("DB Query failed:", err);
    }
}

run().catch(console.error);

