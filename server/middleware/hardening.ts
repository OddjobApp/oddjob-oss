/**
 * Application Hardening Middleware
 * 
 * Provides reliability and observability features:
 * - Comprehensive health checks (DB, Redis, Qdrant)
 * - Graceful shutdown handling
 * - Request timeout middleware
 */

import { Request, Response, NextFunction, Application } from "express";
import { checkDatabaseConnection, pool, getPoolMetrics } from "../database_service.js";
import { redis } from "../domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("Hardening");

// Track server state
let isShuttingDown = false;
let activeConnections = 0;

// ============================================================================
// HEALTH CHECK
// ============================================================================

export interface HealthStatus {
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: string;
    uptime: number;
    version: string;
    checks: {
        database: { status: "up" | "down"; latencyMs?: number; poolMetrics?: any; error?: string };
        redis: { status: "up" | "down"; error?: string };
        qdrant?: { status: "up" | "down"; error?: string };
    };
}

export async function getHealthStatus(): Promise<HealthStatus> {
    const startTime = process.hrtime();
    const checks: HealthStatus["checks"] = {
        database: { status: "down" },
        redis: { status: "down" },
    };

    // Check Database
    try {
        const dbStart = Date.now();
        const dbHealth = await checkDatabaseConnection();
        const dbLatency = Date.now() - dbStart;

        checks.database = {
            status: dbHealth.connected ? "up" : "down",
            latencyMs: dbLatency,
            poolMetrics: dbHealth.metrics,
            error: dbHealth.error,
        };
    } catch (error: any) {
        checks.database = { status: "down", error: error.message };
    }

    // Check Redis
    try {
        await redis.ping();
        checks.redis = { status: "up" };
    } catch (error: any) {
        checks.redis = { status: "down", error: error.message };
    }

    // Check Qdrant (if configured)
    if (process.env.QDRANT_URL) {
        try {
            const qdrantUrl = process.env.QDRANT_URL.replace(/\/$/, "");
            const response = await fetch(`${qdrantUrl}/healthz`, {
                signal: AbortSignal.timeout(5000)
            });
            checks.qdrant = { status: response.ok ? "up" : "down" };
        } catch (error: any) {
            checks.qdrant = { status: "down", error: error.message };
        }
    }

    // Determine overall status
    const allUp = Object.values(checks).every(c => c.status === "up");
    const allDown = Object.values(checks).every(c => c.status === "down");

    let status: HealthStatus["status"] = "healthy";
    if (allDown) {
        status = "unhealthy";
    } else if (!allUp) {
        status = "degraded";
    }

    return {
        status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || "1.0.0",
        checks,
    };
}

export function healthCheckHandler(req: Request, res: Response, next: NextFunction) {
    if (req.path === "/health" && req.get("accept")?.includes("text/html")) {
        return next();
    }

    if (isShuttingDown) {
        return res.status(503).json({ status: "shutting_down" });
    }

    getHealthStatus()
        .then(health => {
            const httpStatus = health.status === "healthy" ? 200 :
                health.status === "degraded" ? 200 : 503;
            res.status(httpStatus).json(health);
        })
        .catch(error => {
            res.status(500).json({ status: "error", error: error.message });
        });
}

// Lightweight liveness probe (just checks if process is running)
export function livenessHandler(req: Request, res: Response) {
    if (isShuttingDown) {
        return res.status(503).json({ alive: false, reason: "shutting_down" });
    }
    res.json({ alive: true });
}

// Readiness probe (checks if ready to accept traffic)
export function readinessHandler(req: Request, res: Response) {
    if (isShuttingDown) {
        return res.status(503).json({ ready: false, reason: "shutting_down" });
    }

    // Quick check - just verify DB pool has connections
    const metrics = getPoolMetrics();
    const ready = metrics.totalCount > 0;

    res.status(ready ? 200 : 503).json({
        ready,
        activeDbConnections: metrics.activeCount,
        waitingQueries: metrics.waitingCount,
    });
}

// ============================================================================
// REQUEST TIMEOUT
// ============================================================================

export function requestTimeout(timeoutMs: number = 300000) {
    return (req: Request, res: Response, next: NextFunction) => {
        // Skip for SSE/streaming endpoints and AI agent execution paths
        if (req.path.includes('/events') || req.path.includes('/chat') || req.path.includes('/agents') || req.headers.accept === 'text/event-stream') {
            return next();
        }

        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                logger.warn(`Request timeout: ${req.method} ${req.path}`, {
                    timeoutMs,
                    correlationId: (req as any).correlationId,
                });
                res.status(504).json({
                    error: "Gateway Timeout",
                    message: "Request took too long to process"
                });
            }
        }, timeoutMs);

        // Clear timeout when response finishes
        res.on('finish', () => clearTimeout(timeout));
        res.on('close', () => clearTimeout(timeout));

        next();
    };
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

export function trackConnections(req: Request, res: Response, next: NextFunction) {
    activeConnections++;
    res.on('finish', () => activeConnections--);
    res.on('close', () => activeConnections--);
    next();
}

export function setupGracefulShutdown(server: any, cleanupFns: Array<() => Promise<void>> = []) {
    const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000', 10);

    const shutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        logger.info(`Received ${signal}, starting graceful shutdown...`);

        // Stop accepting new connections
        server.close(() => {
            logger.info("HTTP server closed");
        });

        // Wait for active connections to complete
        const waitForConnections = async () => {
            const startWait = Date.now();
            while (activeConnections > 0 && Date.now() - startWait < SHUTDOWN_TIMEOUT_MS - 5000) {
                logger.info(`Waiting for ${activeConnections} active connections...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        };

        try {
            await waitForConnections();

            // Run cleanup functions
            for (const cleanup of cleanupFns) {
                try {
                    await cleanup();
                } catch (error: any) {
                    logger.error("Cleanup function failed:", error.message);
                }
            }

            // Close database pool
            try {
                await pool.end();
                logger.info("Database pool closed");
            } catch (error: any) {
                logger.error("Error closing database pool:", error.message);
            }

            // Close Redis
            try {
                await redis.shutdown();
                logger.info("Redis connection closed");
            } catch (error: any) {
                logger.error("Error closing Redis:", error.message);
            }

            logger.info("Graceful shutdown complete");
            process.exit(0);
        } catch (error) {
            logger.error("Error during shutdown:", error);
            process.exit(1);
        }
    };

    // Force exit after timeout
    const forceExit = (signal: string) => {
        setTimeout(() => {
            logger.error(`Forced exit after ${SHUTDOWN_TIMEOUT_MS}ms timeout`);
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        shutdown(signal);
    };

    process.on('SIGTERM', () => forceExit('SIGTERM'));
    process.on('SIGINT', () => forceExit('SIGINT'));

    logger.info("Graceful shutdown handler installed");
}

// ============================================================================
// REGISTER ALL HARDENING FEATURES
// ============================================================================

export function setupHardening(app: Application, server?: any) {
    // Request timeout (30 seconds default, configurable)
    const timeoutMs = parseInt(process.env.REQUEST_TIMEOUT_MS || '300000', 10);
    app.use(requestTimeout(timeoutMs));

    // Track active connections for graceful shutdown
    app.use(trackConnections);

    // Health check endpoints
    app.get('/health', healthCheckHandler);
    app.get('/healthz', healthCheckHandler);  // Kubernetes style
    app.get('/health/live', livenessHandler);
    app.get('/health/ready', readinessHandler);

    // Setup graceful shutdown
    if (server) {
        setupGracefulShutdown(server);
    }

    logger.info("Hardening middleware installed", {
        requestTimeoutMs: timeoutMs,
        shutdownTimeoutMs: process.env.SHUTDOWN_TIMEOUT_MS || '30000',
    });
}

