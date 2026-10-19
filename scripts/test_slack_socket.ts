
import { SlackSocketListener } from "../server/domain/integrations/slack-socket-listener.js";
import { createLogger } from "../server/utils/logger.js";

const logger = createLogger("SlackTest");

async function main() {
    logger.info("Starting Slack Socket Listener Test...");
    await SlackSocketListener.startAll();
    logger.info("Slack Socket Listener Test Running. Press Ctrl+C to stop.");
}

main().catch(error => {
    logger.error("Failed to start Slack Socket Listener:", error);
    process.exit(1);
});
