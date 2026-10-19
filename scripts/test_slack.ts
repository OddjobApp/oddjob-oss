
import "dotenv/config";
import { SlackSocketListener } from "../server/domain/integrations/slack-socket-listener.js";
import { createLogger } from "../server/utils/logger.js";

const logger = createLogger("TestSlack");

async function main() {
    logger.info("Starting Slack Socket Mode Test...");
    try {
        await SlackSocketListener.startAll();
        logger.info("Slack Socket Mode started. Waiting for events...");
        
        // Keep alive
        await new Promise(() => {});
    } catch (err) {
        logger.error("Failed to start Slack Socket Mode:", err);
        process.exit(1);
    }
}

main();
