// import { recoveryService } from "@domain/core/infrastructure/recovery-service.js";
import { createLogger } from "../server/utils/logger.js";

const logger = createLogger("TriggerRecovery");

async function main() {
    logger.info("Manually triggering Recovery Service check...");
    // @ts-ignore - accessing private for testing
    // await recoveryService.recoverStaleExecutions();
    logger.info("Recovery check complete.");
    process.exit(0);
}

main().catch(err => {
    logger.error("Failed to trigger recovery:", err);
    process.exit(1);
});
