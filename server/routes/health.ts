import { Router, type Request, type Response } from "express";
import { Queue } from "bullmq";
import { redis, getRedisOptions, getCacheMetrics } from "@domain/core/infrastructure/redis/redis-client.js";
import { ResourceGovernor } from "@domain/governance/core/resource-governor.js";
import { createLogger } from "@server/utils/logger.js";
import { checkDatabaseConnection, getPoolMetrics } from "@server/database_service.js";
import { QdrantClient } from "@qdrant/js-client-rest";
import { OllamaService } from "@domain/ai/core/ollama.service.js";
import v8 from "v8";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { kafkaEventBus } from "@domain/core/infrastructure/kafka-event-bus.service.js";


const router = Router();
const logger = createLogger("HealthRoute");
const ollamaService = new OllamaService(process.env.OLLAMA_BASE_URL || "http://localhost:11434");

// Models that getOptimalModelForTask() depends on for local SLM routing
const REQUIRED_SLM_MODELS = ["llama3.2", "phi3", "deepseek-r1"];

// Singleton Qdrant client — created once, not per-request
const qdrantClient = new QdrantClient({
    url: process.env.QDRANT_URL || "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY,
});

const TRACKED_QUEUES = [
    "oddjob-rolling-wave",
    "cycle-operations",
    "oddjob-jobs",
    "oddjob-ai",
    "oddjob-knowledge-extraction",
    "oddjob-stream",
];

/**
 * GET /api/health/workers
 * Returns BullMQ queue depths, system resource pressure, and Redis connectivity.
 * Does not require authentication — used by load balancers and monitoring tools.
 */
router.get("/workers", async (_req: Request, res: Response) => {
    try {
        const [systemHealth, queueStats] = await Promise.all([
            Promise.resolve(ResourceGovernor.getSystemHealth()),
            getQueueStats(),
        ]);

        const redisOk = !!(redis && await redis.ping().catch(() => null));

        res.json({
            status: systemHealth.status,
            system: {
                cpuLoadPct: Math.round(systemHealth.cpuLoad * 100),
                memPressurePct: Math.round(systemHealth.memPressure * 100),
            },
            redis: { connected: redisOk },
            queues: queueStats,
            timestamp: new Date().toISOString(),
        });
    } catch (err: any) {
        logger.error("[Health] Worker health check failed", { error: err.message });
        res.status(500).json({ status: "error", error: err.message });
    }
});

async function getQueueStats() {
    const opts = { ...getRedisOptions(), maxRetriesPerRequest: null };
    const results: Record<string, any> = {};

    await Promise.all(TRACKED_QUEUES.map(async (name) => {
        try {
            const q = new Queue(name, { connection: opts });
            const counts = await q.getJobCounts("waiting", "active", "failed", "delayed");
            await q.close();
            results[name] = counts;
        } catch {
            results[name] = { error: "unavailable" };
        }
    }));

    return results;
}

/**
 * GET /api/v1/health
 * Deep health check endpoint for load balancers and monitoring.
 * Checks database connectivity, Redis, Qdrant, and queue health.
 */
// Path is relative to the mount points in registerHealthRoutes below. It used to be
// "/v1/health", which combined with app.use("/api/v1", router) resolved to
// /api/v1/v1/health — so the deep check was only reachable at a doubled path and
// the /api/v1/health the UI polls fell through to a 401/404.
router.get("/health", async (_req: Request, res: Response) => {
    const startTime = Date.now();
    const checks: Record<string, { status: string; responseTimeMs?: number; error?: string; details?: any }> = {};
    let overallStatus = "healthy";

    // Database check
    try {
        const dbStart = Date.now();
        const dbResult = await checkDatabaseConnection();
        checks.database = {
            status: dbResult.connected ? "healthy" : "unhealthy",
            responseTimeMs: Date.now() - dbStart,
            details: dbResult.connected ? { poolMetrics: dbResult.metrics } : { error: dbResult.error },
        };
        if (!dbResult.connected) overallStatus = "unhealthy";
    } catch (err: any) {
        checks.database = { status: "unhealthy", error: err.message };
        overallStatus = "unhealthy";
    }

    // Redis check
    try {
        const redisStart = Date.now();
        const redisPing = await redis.ping();
        checks.redis = {
            status: redisPing === "PONG" ? "healthy" : "degraded",
            responseTimeMs: Date.now() - redisStart,
        };
        if (redisPing !== "PONG") overallStatus = overallStatus === "healthy" ? "degraded" : overallStatus;
    } catch (err: any) {
        checks.redis = { status: "unhealthy", error: err.message };
        overallStatus = "unhealthy";
    }

    // Kafka is optional during migration. When explicitly required, loss of
    // connectivity makes the service unhealthy; otherwise it is degraded.
    try {
        const kafkaStart = Date.now();
        const kafka = await kafkaEventBus.health();
        checks.kafka = {
            status: !kafka.enabled ? "disabled" : kafka.connected ? "healthy" : "unhealthy",
            responseTimeMs: Date.now() - kafkaStart,
            details: { brokers: kafka.brokers, lastError: kafka.lastError },
        };
        if (kafka.enabled && !kafka.connected) {
            overallStatus = process.env.KAFKA_REQUIRED === "true" ? "unhealthy" : "degraded";
        }
    } catch (err: any) {
        checks.kafka = { status: "unhealthy", error: err.message };
        overallStatus = process.env.KAFKA_REQUIRED === "true" ? "unhealthy" : "degraded";
    }

    // Qdrant check
    try {
        const qdrantStart = Date.now();
        const collections = await qdrantClient.getCollections();
        checks.qdrant = {
            status: "healthy",
            responseTimeMs: Date.now() - qdrantStart,
            details: { collectionsCount: collections.collections.length },
        };
    } catch (err: any) {
        checks.qdrant = { status: "unhealthy", error: err.message };
        // Qdrant might be optional, so mark as degraded rather than unhealthy
        if (overallStatus === "healthy") overallStatus = "degraded";
    }

    // Queue health check
    try {
        const queueStart = Date.now();
        const queueStats = await getQueueStats();
        const hasFailedJobs = Object.values(queueStats).some((stats: any) =>
            stats?.failed > 0 || stats?.error
        );
        checks.queues = {
            status: hasFailedJobs ? "degraded" : "healthy",
            responseTimeMs: Date.now() - queueStart,
            details: queueStats,
        };
        if (hasFailedJobs && overallStatus === "healthy") overallStatus = "degraded";
    } catch (err: any) {
        checks.queues = { status: "unhealthy", error: err.message };
        overallStatus = "unhealthy";
    }

    // System resources
    try {
        const systemHealth = ResourceGovernor.getSystemHealth();
        const heapUsed = process.memoryUsage().heapUsed;
        const heapLimit = v8.getHeapStatistics().heap_size_limit;
        const heapUsedPct = Math.round((heapUsed / heapLimit) * 100);
        checks.system = {
            status: systemHealth.status,
            details: {
                cpuLoadPct: Math.round(systemHealth.cpuLoad * 100),
                memPressurePct: Math.round(systemHealth.memPressure * 100),
                heapUsedPct,
                heapUsedMb: Math.round(heapUsed / 1024 / 1024),
                heapLimitMb: Math.round(heapLimit / 1024 / 1024),
            },
        };
        if (heapUsedPct > 85 && overallStatus === "healthy") overallStatus = "degraded";
        if (systemHealth.status !== "healthy" && overallStatus === "healthy") {
            overallStatus = "degraded";
        }
    } catch (err: any) {
        checks.system = { status: "unknown", error: err.message };
    }

    // Ollama / Local SLM check
    try {
        const ollamaStart = Date.now();
        const version = await ollamaService.getVersion();
        if (!version) {
            checks.ollama = {
                status: "offline",
                responseTimeMs: Date.now() - ollamaStart,
                details: { message: "Ollama is not reachable. SLM tasks will fall back to cloud providers." },
            };
            if (overallStatus === "healthy") overallStatus = "degraded";
        } else {
            const models = await ollamaService.listModels();
            const installedNames = models.map((m) => m.name.split(":")[0]);
            const missingModels = REQUIRED_SLM_MODELS.filter((m) => !installedNames.includes(m));
            checks.ollama = {
                status: missingModels.length > 0 ? "degraded" : "healthy",
                responseTimeMs: Date.now() - ollamaStart,
                details: {
                    version: version.version,
                    installedModels: installedNames,
                    requiredModels: REQUIRED_SLM_MODELS,
                    missingModels,
                    message: missingModels.length > 0
                        ? `Missing SLM models: ${missingModels.join(", ")}. Run: ollama pull <model>`
                        : "All required SLM models are installed.",
                },
            };
            if (missingModels.length > 0 && overallStatus === "healthy") overallStatus = "degraded";
        }
    } catch (err: any) {
        checks.ollama = { status: "offline", error: err.message };
        if (overallStatus === "healthy") overallStatus = "degraded";
    }

    const totalResponseTime = Date.now() - startTime;

    const response = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        responseTimeMs: totalResponseTime,
        version: process.env.npm_package_version || "unknown",
        environment: process.env.NODE_ENV || "unknown",
        checks,
    };

    const statusCode = overallStatus === "healthy" ? 200 : overallStatus === "degraded" ? 200 : 503;
    res.status(statusCode).json(response);
});

/**
 * GET /api/health/cache-metrics
 * Returns Redis cache metrics including hit rate, operations count, and errors.
 */
router.get("/cache-metrics", async (_req: Request, res: Response) => {
    try {
        const metrics = getCacheMetrics();
        res.json({
            status: "success",
            timestamp: new Date().toISOString(),
            metrics,
        });
    } catch (err: any) {
        logger.error("[Health] Cache metrics check failed", { error: err.message });
        res.status(500).json({ status: "error", error: err.message });
    }
});

/**
 * GET /api/health/triage-brief
 * Returns a deterministic, live health triage brief.
 */
router.get("/triage-brief", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { monitoringService } = await import("@domain/core/infrastructure/monitoring.service.js");
    const brief = await monitoringService.getHealthTriageBrief(orgContext);
    res.json(brief);
}));

export function registerHealthRoutes(app: any) {
    app.use("/api/health", router);
    // Also register at /api/v1/health for backward compatibility and standards compliance
    app.use("/api/v1", router);
}
