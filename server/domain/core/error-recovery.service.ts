import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { appDeployments, apps, missionRuns, missions } from "@shared/schema/index.js";

const logger = createLogger("ErrorRecoveryService");

/**
 * Retry configuration
 */
interface RetryConfig {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
};

/**
 * Dead letter queue entry
 */
interface DeadLetterEntry {
    id: string;
    eventType: string;
    payload: any;
    error: string;
    timestamp: Date;
    retryCount: number;
    organizationId?: number;
}

/**
 * Error Recovery Service
 * Handles retry logic, automatic rollback, and dead letter queue
 */
export class ErrorRecoveryService {
    private static instance: ErrorRecoveryService;
    private deadLetterQueue: Map<string, DeadLetterEntry> = new Map();
    private retryTimers: Map<string, NodeJS.Timeout> = new Map();

    private constructor() {
        this.startDeadLetterQueueProcessor();
    }

    static getInstance(): ErrorRecoveryService {
        if (!ErrorRecoveryService.instance) {
            ErrorRecoveryService.instance = new ErrorRecoveryService();
        }
        return ErrorRecoveryService.instance;
    }

    /**
     * Execute with retry logic
     */
    async executeWithRetry<T>(
        operation: () => Promise<T>,
        config: RetryConfig = DEFAULT_RETRY_CONFIG,
        operationName: string = "operation"
    ): Promise<T> {
        let lastError: Error | null = null;
        let delay = config.initialDelayMs;

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                lastError = error;
                logger.warn(`[ErrorRecovery] ${operationName} failed (attempt ${attempt + 1}/${config.maxRetries + 1}): ${error.message}`);

                if (attempt < config.maxRetries) {
                    await this.sleep(delay);
                    delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
                }
            }
        }

        throw lastError || new Error(`${operationName} failed after ${config.maxRetries + 1} attempts`);
    }

    /**
     * Add entry to dead letter queue
     */
    addToDeadLetterQueue(
        eventType: string,
        payload: any,
        error: string,
        organizationId?: number
    ): string {
        const id = `dlq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const entry: DeadLetterEntry = {
            id,
            eventType,
            payload,
            error,
            timestamp: new Date(),
            retryCount: 0,
            organizationId,
        };

        this.deadLetterQueue.set(id, entry);
        logger.error(`[ErrorRecovery] Added to dead letter queue: ${eventType} (${id})`);

        return id;
    }

    /**
     * Retry dead letter queue entry
     */
    async retryDeadLetterEntry(id: string, retryHandler: (entry: DeadLetterEntry) => Promise<void>): Promise<void> {
        const entry = this.deadLetterQueue.get(id);
        if (!entry) {
            throw new Error(`Dead letter entry not found: ${id}`);
        }

        try {
            await retryHandler(entry);
            this.deadLetterQueue.delete(id);
            logger.info(`[ErrorRecovery] Successfully retried dead letter entry: ${id}`);
        } catch (error: any) {
            entry.retryCount++;
            entry.error = error.message;
            entry.timestamp = new Date();

            if (entry.retryCount >= 3) {
                logger.error(`[ErrorRecovery] Dead letter entry exceeded max retries: ${id}`);
                // Keep in queue for manual inspection
            } else {
                logger.warn(`[ErrorRecovery] Dead letter entry retry failed (${entry.retryCount}/3): ${id}`);
            }
        }
    }

    /**
     * Get dead letter queue entries
     */
    getDeadLetterQueueEntries(organizationId?: number): DeadLetterEntry[] {
        const entries = Array.from(this.deadLetterQueue.values());
        if (organizationId) {
            return entries.filter(e => e.organizationId === organizationId);
        }
        return entries;
    }

    /**
     * Clear dead letter queue entry
     */
    clearDeadLetterEntry(id: string): void {
        this.deadLetterQueue.delete(id);
        logger.info(`[ErrorRecovery] Cleared dead letter entry: ${id}`);
    }

    /**
     * Rollback blueprint installation
     */
    async rollbackBlueprintInstallation(organizationId: number, blueprintName: string): Promise<void> {
        logger.info(`[ErrorRecovery] Rolling back blueprint installation: ${blueprintName} for org ${organizationId}`);

        try {
            // Rollback mission instances created during installation
            const missionsToDelete = await db.select()
                .from(missions)
                .where(and(
                    eq(missions.organizationId, organizationId),
                    sql`${missions.name} LIKE ${`%${blueprintName}%`}`
                ));

            for (const mission of missionsToDelete) {
                await db.delete(missions).where(eq(missions.id, mission.id));
            }

            // Rollback app deployments created during installation
            const deploymentsToDelete = await db.select()
                .from(appDeployments)
                .where(and(
                    eq(appDeployments.organizationId, organizationId),
                    sql`${appDeployments.status} = 'queued'`
                ));

            for (const deployment of deploymentsToDelete) {
                await db.delete(appDeployments).where(eq(appDeployments.id, deployment.id));
                await db.delete(apps).where(eq(apps.id, deployment.appId));
            }

            logger.info(`[ErrorRecovery] Rollback complete for ${blueprintName}`);
        } catch (error: any) {
            logger.error(`[ErrorRecovery] Rollback failed for ${blueprintName}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Retry failed forge jobs
     */
    async retryFailedForgeJobs(organizationId: number): Promise<void> {
        logger.info(`[ErrorRecovery] Retrying failed forge jobs for org ${organizationId}`);

        const failedDeployments = await db.select()
            .from(appDeployments)
            .where(and(
                eq(appDeployments.organizationId, organizationId),
                eq(appDeployments.status, "failed")
            ));

        for (const deployment of failedDeployments) {
            try {
                const { appForgeService } = await import("../apps/app-forge.service.js");
                const app = await db.select().from(apps).where(eq(apps.id, deployment.appId)).limit(1);
                
                if (app.length > 0) {
                    await appForgeService.forgeApp("blueprint-import", {
                        name: app[0].name,
                        slug: app[0].slug,
                        description: app[0].description || "Retry from failed deployment",
                        organizationId,
                        oddjobMissionId: 0,
                        vNextManifest: app[0].vNextManifest,
                    });

                    // Update status to queued
                    await db.update(appDeployments)
                        .set({ status: "queued" })
                        .where(eq(appDeployments.id, deployment.id));

                    logger.info(`[ErrorRecovery] Retried forge job for app ${app[0].slug}`);
                }
            } catch (error: any) {
                logger.error(`[ErrorRecovery] Failed to retry forge job for deployment ${deployment.id}: ${error.message}`);
            }
        }
    }

    /**
     * Schedule retry with exponential backoff
     */
    scheduleRetry(
        id: string,
        operation: () => Promise<void>,
        config: RetryConfig = DEFAULT_RETRY_CONFIG
    ): void {
        const executeRetry = async (attempt: number) => {
            try {
                await operation();
                this.retryTimers.delete(id);
                logger.info(`[ErrorRecovery] Retry successful for ${id} (attempt ${attempt})`);
            } catch (error: any) {
                if (attempt < config.maxRetries) {
                    const delay = Math.min(
                        config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
                        config.maxDelayMs
                    );
                    logger.warn(`[ErrorRecovery] Retry failed for ${id} (attempt ${attempt}), retrying in ${delay}ms`);
                    
                    const timer = setTimeout(() => executeRetry(attempt + 1), delay);
                    this.retryTimers.set(id, timer);
                } else {
                    logger.error(`[ErrorRecovery] Retry failed for ${id} after ${config.maxRetries + 1} attempts`);
                    this.retryTimers.delete(id);
                }
            }
        };

        executeRetry(0);
    }

    /**
     * Cancel scheduled retry
     */
    cancelRetry(id: string): void {
        const timer = this.retryTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.retryTimers.delete(id);
            logger.info(`[ErrorRecovery] Cancelled retry for ${id}`);
        }
    }

    /**
     * Start dead letter queue processor
     */
    private startDeadLetterQueueProcessor(): void {
        // Process dead letter queue every 5 minutes
        setInterval(() => {
            this.processDeadLetterQueue();
        }, 5 * 60 * 1000);
    }

    /**
     * Process dead letter queue. Entries that succeed are removed; entries that
     * fail get their retryCount incremented (capped at 3). Entries at the cap
     * stay in the queue for human inspection — they're not silently discarded.
     */
    private async processDeadLetterQueue(): Promise<void> {
        const entries = Array.from(this.deadLetterQueue.values());
        if (entries.length === 0) return;
        logger.info(`[ErrorRecovery] Processing dead letter queue: ${entries.length} entries`);

        for (const entry of entries) {
            if (entry.retryCount >= 3) continue; // Cap reached — leave for manual review

            try {
                let succeeded = false;
                switch (entry.eventType) {
                    case "APP_PROVISIONED":
                        succeeded = await this.retryAppProvisioning(entry);
                        break;
                    case "BLUEPRINT_INSTALLED":
                        succeeded = await this.retryBlueprintInstallation(entry);
                        break;
                    default:
                        logger.warn(`[ErrorRecovery] Unknown event type in DLQ: ${entry.eventType} — leaving in queue`);
                        continue;
                }

                if (succeeded) {
                    this.deadLetterQueue.delete(entry.id);
                    logger.info(`[ErrorRecovery] DLQ entry ${entry.id} succeeded on retry ${entry.retryCount + 1} — removed`);
                } else {
                    entry.retryCount++;
                    logger.warn(`[ErrorRecovery] DLQ entry ${entry.id} failed retry — count now ${entry.retryCount}/3`);
                }
            } catch (error: any) {
                entry.retryCount++;
                entry.error = `${entry.error} | retry ${entry.retryCount} threw: ${error.message}`;
                logger.error(`[ErrorRecovery] DLQ entry ${entry.id} retry threw: ${error.message}`);
            }
        }
    }

    /**
     * Retry app provisioning by re-invoking appRegistryService.installApp.
     * Payload must carry appId + organizationId from the original event.
     */
    private async retryAppProvisioning(entry: DeadLetterEntry): Promise<boolean> {
        const appId: number | undefined = entry.payload?.appId;
        const orgId: number | undefined = entry.organizationId ?? entry.payload?.organizationId;
        if (!appId || !orgId) {
            logger.warn(`[ErrorRecovery] DLQ ${entry.id} missing appId or orgId — cannot retry app provisioning`);
            return false;
        }
        logger.info(`[ErrorRecovery] Retrying app provisioning: appId=${appId} orgId=${orgId}`);
        const { appRegistryService } = await import("@domain/apps/app-registry.service.js");
        const result = await appRegistryService.installApp(appId, orgId);
        return !!result?.deployment?.id;
    }

    /**
     * Retry blueprint installation by re-reading the cycle YAML referenced in
     * the payload and re-invoking orgForgeService.installCycleApp.
     */
    private async retryBlueprintInstallation(entry: DeadLetterEntry): Promise<boolean> {
        const orgId: number | undefined = entry.organizationId ?? entry.payload?.organizationId;
        const blueprintName: string | undefined = entry.payload?.blueprintName;
        const appSlug: string | undefined = entry.payload?.appSlug ?? entry.payload?.slug;
        if (!orgId || (!blueprintName && !appSlug)) {
            logger.warn(`[ErrorRecovery] DLQ ${entry.id} missing orgId or blueprint reference — cannot retry`);
            return false;
        }

        // Locate the cycle YAML on disk by app slug, falling back to a slugified blueprint name
        const path = await import("path");
        const fs = await import("fs/promises");
        const slugCandidate = appSlug ?? (blueprintName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const yamlPath = path.resolve(process.cwd(), "server", "cycles", `${slugCandidate}.cycle.yaml`);

        let yamlContent: string;
        try {
            yamlContent = await fs.readFile(yamlPath, "utf-8");
        } catch (err: any) {
            logger.warn(`[ErrorRecovery] DLQ ${entry.id} cycle YAML not found at ${yamlPath}: ${err.message}`);
            return false;
        }

        logger.info(`[ErrorRecovery] Retrying blueprint install: slug=${slugCandidate} orgId=${orgId}`);
        const { orgForgeService } = await import("@domain/org/core/org-forge.service.js");
        const result = await orgForgeService.installCycleApp(orgId, yamlContent);
        return result?.success === true;
    }

    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get retry statistics
     */
    getRetryStats(): {
        deadLetterQueueSize: number;
        activeRetries: number;
        entriesByEventType: Record<string, number>;
    } {
        const entries = Array.from(this.deadLetterQueue.values());
        const entriesByEventType: Record<string, number> = {};

        for (const entry of entries) {
            entriesByEventType[entry.eventType] = (entriesByEventType[entry.eventType] || 0) + 1;
        }

        return {
            deadLetterQueueSize: entries.length,
            activeRetries: this.retryTimers.size,
            entriesByEventType,
        };
    }
}

export const errorRecoveryService = ErrorRecoveryService.getInstance();
