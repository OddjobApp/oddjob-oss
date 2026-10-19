import "dotenv/config";
import { initTracing } from "./instrumentation.js";
initTracing();

import { createLogger } from "./utils/logger.js";

const logger = createLogger("ExtractionWorkerOnly");

async function startExtractionWorker() {
    const { startExtractionWorker: fn } = await import("./domain/knowledge/knowledge-queue.js");
    return fn();
}

async function main() {
    logger.info("Starting Extraction Worker Only...");
    try {
        await startExtractionWorker();
        logger.info("[✓] Extraction worker started");
    } catch (err: any) {
        logger.error(`[✗] Extraction worker failed: ${err.message}`);
        console.error(err);
        process.exit(1);
    }
    logger.info("Worker ready. Press Ctrl+C to stop.");
}

main();

