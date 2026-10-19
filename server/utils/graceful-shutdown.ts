import { createLogger } from "./logger.js";

const logger = createLogger("GracefulShutdown");

const workers: Array<{ close: () => Promise<void>; name?: string }> = [];
let shutdownInitiated = false;

/**
 * Register a BullMQ worker (or any closeable resource) for graceful shutdown.
 * On SIGTERM/SIGINT the registered resources are closed in reverse order
 * with a configurable drain timeout.
 */
export function registerWorker(worker: { close: () => Promise<void> }, name?: string) {
    workers.push({ ...worker, name });
}

/**
 * Install SIGTERM and SIGINT handlers.
 * Call once at server startup. Safe to call multiple times (idempotent).
 */
export function installShutdownHandlers(drainTimeoutMs = 30000) {
    let installed = false;
    return () => {
        if (installed) return;
        installed = true;

        const shutdown = async (signal: string) => {
            if (shutdownInitiated) return;
            shutdownInitiated = true;

            logger.info(`[GracefulShutdown] ${signal} received — draining ${workers.length} worker(s) (timeout: ${drainTimeoutMs}ms)`);

            const drainAll = Promise.allSettled(
                [...workers].reverse().map(async (w) => {
                    try {
                        await w.close();
                        logger.info(`[GracefulShutdown] Worker ${w.name ?? '(unnamed)'} closed`);
                    } catch (err: any) {
                        logger.warn(`[GracefulShutdown] Worker ${w.name ?? '(unnamed)'} close error: ${err.message}`);
                    }
                })
            );

            const timeout = new Promise<void>((resolve) =>
                setTimeout(() => {
                    logger.warn(`[GracefulShutdown] Drain timeout — forcing exit`);
                    resolve();
                }, drainTimeoutMs)
            );

            await Promise.race([drainAll, timeout]);
            logger.info("[GracefulShutdown] Clean exit");
            process.exit(0);
        };

        process.once("SIGTERM", () => shutdown("SIGTERM"));
        process.once("SIGINT", () => shutdown("SIGINT"));
    };
}

export const ensureShutdownHandlers = installShutdownHandlers();
