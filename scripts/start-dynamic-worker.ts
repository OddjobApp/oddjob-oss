
import { startDynamicMissionWorker } from '../server/domain/mission/infrastructure/dynamic-mission-worker.js';
import { createLogger } from '../server/utils/logger.js';

const logger = createLogger("ManualWorker");

async function main() {
    logger.info("Starting Dynamic Mission Worker manually...");
    startDynamicMissionWorker();
    
    // Keep alive
    setInterval(() => {
        logger.info("Worker heartbeating...");
    }, 60000);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
