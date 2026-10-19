import { pool } from "../db/index.js";
import { redisService } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "./logger.js";

const logger = createLogger("ScriptCleanup");

/**
 * Wrapper for diagnostic and repair scripts to ensure they exit cleanly.
 * Automatically closes database pool and Redis connections.
 */
export async function runScript(fn: () => Promise<void>) {
    try {
        await fn();
        logger.info("Script completed successfully.");
    } catch (err: any) {
        logger.error(`Script failed: ${err.message}`);
        if (err.stack) logger.error(err.stack);
        process.exit(1);
    } finally {
        await cleanup();
        process.exit(0);
    }
}

async function cleanup() {
    logger.info("Cleaning up connections...");
    
    // Stop DB metrics interval - No longer available in current db index
    
    // Close DB pool
    try {
        await pool.end();
        logger.info("Database pool closed.");
    } catch (err: any) {
        logger.error(`Error closing database pool: ${err.message}`);
    }
    
    // Close Redis service
    try {
        await redisService.shutdown();
        logger.info("Redis service shut down.");
    } catch (err: any) {
        logger.error(`Error shutting down Redis: ${err.message}`);
    }
}

