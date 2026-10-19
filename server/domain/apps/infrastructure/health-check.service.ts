import { db } from "@server/database_service.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { appInstances, appDeployments, apps } from "@shared/schema/index.js";
import { healthCheckResults, healthCheckConfig, healthCheckFailures } from "@shared/schema/infrastructure/phase-1a.js";
import { alerts } from "@shared/schema/alerts.js";
import { eq, and, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import axios from "axios";

const logger = createLogger("HealthCheckService");

export interface HealthStatusResult {
    instanceId: number;
    appId: number;
    orgId: number;
    status: "healthy" | "degraded" | "unhealthy" | "unknown";
    responseTimeMs: number;
    statusCode?: number;
    databaseStatus?: string;
    cacheStatus?: string;
    brokerStatus?: string;
    errorMessage?: string;
}

export class HealthCheckService {
    private isRunning = false;
    private timer: NodeJS.Timeout | null = null;
    private lockKey = "health:checker:lock";
    private lockTTL = 60; // seconds
    private defaultIntervalMs = 30000; // 30 seconds

    constructor() {}

    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn("Health check service already running");
            return;
        }

        this.isRunning = true;
        logger.info("Starting health check background task");

        const loop = async () => {
            if (!this.isRunning) return;
            try {
                const lockAcquired = await this.acquireLock();
                if (!lockAcquired) {
                    logger.debug("Could not acquire lock, skipping health check sweep");
                    return;
                }

                try {
                    await this.performHealthChecks();
                } finally {
                    await this.releaseLock();
                }
            } catch (error: any) {
                logger.error(`Health check sweep failed: ${error.message}`);
            } finally {
                if (this.isRunning) {
                    this.timer = setTimeout(loop, this.defaultIntervalMs);
                }
            }
        };

        this.timer = setTimeout(loop, 2000); // Initial boot delay
    }

    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info("Stopped health check background task");
    }

    private async acquireLock(): Promise<boolean> {
        try {
            const result = await redis.set(this.lockKey, "1", "EX", this.lockTTL, "NX");
            return result === "OK";
        } catch (err: any) {
            logger.warn(`Redis health lock acquire failed: ${err.message}`);
            return false;
        }
    }

    private async releaseLock(): Promise<void> {
        try {
            await redis.del(this.lockKey);
        } catch (err: any) {
            logger.warn(`Redis health lock release failed: ${err.message}`);
        }
    }

    private async performHealthChecks(): Promise<void> {
        const instances = await this.getActiveInstances();
        for (const instance of instances) {
            try {
                await this.checkInstanceHealth(instance);
            } catch (err: any) {
                logger.error(`Error checking health of instance ${instance.instanceId}: ${err.message}`);
            }
        }
    }

    private async getActiveInstances() {
        const rows = await db
            .select({
                instanceId: appInstances.id,
                appId: apps.id,
                orgId: apps.organizationId,
                port: appInstances.port,
                status: appInstances.status,
            })
            .from(appInstances)
            .innerJoin(appDeployments, eq(appInstances.deploymentId, appDeployments.id))
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(
                and(
                    eq(apps.status, "active"),
                    inArray(appInstances.status, ["running", "starting", "unhealthy"])
                )
            );

        return rows.filter((r): r is typeof r & { orgId: number } => r.orgId !== null);
    }

    private async checkInstanceHealth(instance: {
        instanceId: number;
        appId: number;
        orgId: number;
        port: number | null;
        status: string;
    }): Promise<void> {
        if (!instance.port) {
            logger.warn(`Instance ${instance.instanceId} has no port assigned, skipping HTTP health check`);
            return;
        }

        const config = await this.getOrCreateConfig(instance.orgId);
        const url = `http://localhost:${instance.port}/api/health`;
        const startTime = Date.now();

        let status: "healthy" | "degraded" | "unhealthy" = "unhealthy";
        let responseTimeMs = 0;
        let statusCode: number | undefined;
        let databaseStatus: string | undefined;
        let cacheStatus: string | undefined;
        let brokerStatus: string | undefined;
        let errorMessage: string | undefined;

        try {
            const res = await axios.get(url, {
                timeout: config.checkTimeoutSeconds * 1000,
                headers: { "User-Agent": "Oddjob-HealthCheckService/1.0" },
            });
            responseTimeMs = Date.now() - startTime;
            statusCode = res.status;

            if (res.status === 200) {
                status = "healthy";
                const data = res.data;
                if (data && typeof data === "object") {
                    databaseStatus = data.database?.status || data.db?.status;
                    cacheStatus = data.cache?.status || data.redis?.status;
                    brokerStatus = data.broker?.status || data.queue?.status;

                    // If critical dependencies are down, degrade/mark unhealthy
                    if (databaseStatus === "unhealthy" || cacheStatus === "unhealthy" || brokerStatus === "unhealthy") {
                        status = "unhealthy";
                    } else if (databaseStatus === "degraded" || cacheStatus === "degraded" || brokerStatus === "degraded") {
                        status = "degraded";
                    }
                }
            }
        } catch (err: any) {
            responseTimeMs = Date.now() - startTime;
            // If /api/health returned 404 or threw, fall back to probing root '/'
            try {
                const rootRes = await axios.get(`http://localhost:${instance.port}/`, {
                    timeout: 3000,
                    headers: { "User-Agent": "Oddjob-HealthCheckService/1.0" },
                    validateStatus: (s) => s >= 200 && s < 400,
                });
                if (rootRes.status >= 200 && rootRes.status < 400) {
                    status = "healthy";
                    statusCode = rootRes.status;
                } else {
                    status = "unhealthy";
                    errorMessage = err.message;
                    if (err.response) statusCode = err.response.status;
                }
            } catch {
                status = "unhealthy";
                errorMessage = err.message;
                if (err.response) {
                    statusCode = err.response.status;
                }
            }
        }

        // 1. Record health check result in DB
        await db.insert(healthCheckResults).values({
            instanceId: instance.instanceId,
            orgId: instance.orgId,
            appId: instance.appId,
            status,
            responseTimeMs,
            statusCode,
            databaseStatus,
            cacheStatus,
            brokerStatus,
            errorMessage,
            alertTriggered: false,
        });

        // 2. If successful, update heartbeat and failures
        if (status === "healthy" || status === "degraded") {
            await db
                .update(appInstances)
                .set({
                    lastHeartbeatAt: new Date(),
                    status: status === "healthy" ? "running" : "unhealthy",
                })
                .where(eq(appInstances.id, instance.instanceId));

            await db
                .insert(healthCheckFailures)
                .values({
                    instanceId: instance.instanceId,
                    failureCount: 0,
                    lastSuccessfulTime: new Date(),
                })
                .onConflictDoUpdate({
                    target: healthCheckFailures.instanceId,
                    set: {
                        failureCount: 0,
                        lastSuccessfulTime: new Date(),
                    },
                });
        } else {
            // Unhealthy
            // 3. Log failure and increment
            const failures = await db
                .select()
                .from(healthCheckFailures)
                .where(eq(healthCheckFailures.instanceId, instance.instanceId))
                .limit(1);

            const count = (failures[0]?.failureCount || 0) + 1;

            await db
                .insert(healthCheckFailures)
                .values({
                    instanceId: instance.instanceId,
                    failureCount: count,
                    lastFailureTime: new Date(),
                })
                .onConflictDoUpdate({
                    target: healthCheckFailures.instanceId,
                    set: {
                        failureCount: count,
                        lastFailureTime: new Date(),
                    },
                });

            // Trigger alert if threshold reached
            if (count >= config.unhealthyThresholdCount && config.alertEnabled) {
                const recentAlert = failures[0]?.alertSentAt;
                const coolingPeriodMs = 15 * 60 * 1000; // 15 mins alert cooling period
                if (!recentAlert || Date.now() - new Date(recentAlert).getTime() > coolingPeriodMs) {
                    await this.triggerAlert(instance, status, count, errorMessage || "HTTP check failed", config);
                    await db
                        .update(healthCheckFailures)
                        .set({ alertSentAt: new Date() })
                        .where(eq(healthCheckFailures.instanceId, instance.instanceId));
                }
            }
        }
    }

    private async triggerAlert(
        instance: { instanceId: number; appId: number; orgId: number },
        status: string,
        failureCount: number,
        error: string,
        config: any
    ) {
        try {
            await db.insert(alerts).values({
                organizationId: instance.orgId,
                severity: config.alertSeverity === "critical" ? "critical" : "warning",
                category: "system",
                message: `App Instance ${instance.instanceId} Health Check Failure`,
                details: {
                    instanceId: instance.instanceId,
                    appId: instance.appId,
                    status,
                    failureCount,
                    error,
                    alertChannels: config.alertChannels,
                },
            });
            logger.warn(`[HealthAlert] Alert logged for instance ${instance.instanceId} after ${failureCount} failures: ${error}`);
        } catch (err: any) {
            logger.error(`Failed to trigger health alert: ${err.message}`);
        }
    }

    private async getOrCreateConfig(orgId: number) {
        const rows = await db
            .select()
            .from(healthCheckConfig)
            .where(eq(healthCheckConfig.orgId, orgId))
            .limit(1);

        if (rows.length > 0) {
            return rows[0];
        }

        // Insert defaults
        const defaults = {
            orgId,
            checkIntervalSeconds: 30,
            checkTimeoutSeconds: 10,
            staleHeartbeatSeconds: 120,
            unhealthyThresholdCount: 3,
            alertEnabled: true,
            alertOnUnhealthy: true,
            alertOnDegraded: false,
            alertOnStaleHeartbeat: true,
            alertOnDependencyIssue: true,
            alertChannels: "slack",
            alertSeverity: "warning" as const,
        };

        const inserted = await db
            .insert(healthCheckConfig)
            .values(defaults)
            .returning();

        return inserted[0];
    }
}

export const healthCheckService = new HealthCheckService();
