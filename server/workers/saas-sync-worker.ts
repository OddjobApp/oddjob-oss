
import { Job } from "bullmq";
import { BaseWorker } from "./base-worker.js";
import { db } from "../database_service.js";
import { saasConnectors, saasSyncConfigs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { saasSyncService } from "../domain/integrations/saas-sync.service.js";

/** Connector status meaning "the stored token is dead — stop retrying, ask for a reconnect". */
const AUTH_FAILED_STATUS = "auth_failed";

/**
 * Provider error names that mean the credential itself is invalid, across the
 * SaaS platforms this worker syncs. None of these can be retried into success.
 */
const PERMANENT_AUTH_ERRORS = [
    // Slack
    "account_inactive", "invalid_auth", "not_authed", "token_revoked", "token_expired",
    "missing_scope", "no_permission",
    // Generic / OAuth (GitHub, Jira, Teams)
    "invalid_token", "unauthorized", "invalid_grant", "insufficient_scope",
];

function isPermanentAuthFailure(err: any): boolean {
    const haystack = `${err?.data?.error ?? ""} ${err?.code ?? ""} ${err?.message ?? ""}`.toLowerCase();
    if (err?.statusCode === 401 || err?.status === 401) return true;
    return PERMANENT_AUTH_ERRORS.some(name => haystack.includes(name));
}

/**
 * SaaSSyncWorker
 * 
 * Periodically syncs SaaS platforms for all organizations that have
 * automated sync enabled.
 */
export class SaaSSyncWorker extends BaseWorker<void, { processed: number, failures: number }> {
    constructor() {
        super("saas-sync", {
            concurrency: parseInt(process.env.SAAS_SYNC_CONCURRENCY || "5", 10),
        });
    }

    protected async execute(job: Job<void>): Promise<{ processed: number, failures: number }> {
        this.logger.info("Starting automated SaaS sync cycle");

        // 1. Fetch all enabled sync configs
        const configs = await db
            .select({
                connectorId: saasSyncConfigs.connectorId,
                syncInterval: saasSyncConfigs.syncInterval,
                platform: saasConnectors.platform,
                orgId: saasConnectors.orgId
            })
            .from(saasSyncConfigs)
            .innerJoin(saasConnectors, eq(saasSyncConfigs.connectorId, saasConnectors.id))
            .where(eq(saasSyncConfigs.enabled, true));

        let processed = 0;
        let failures = 0;

        for (const config of configs) {
            try {
                this.logger.info(`Auto-syncing ${config.platform} for Org ${config.orgId}`);
                
                // Check last sync time to respect interval
                const [connector] = await db
                    .select()
                    .from(saasConnectors)
                    .where(eq(saasConnectors.id, config.connectorId))
                    .limit(1);

                const lastSync = connector?.lastSync;
                const intervalMs = (config.syncInterval || 15) * 60 * 1000;

                if (lastSync && (Date.now() - new Date(lastSync).getTime() < intervalMs)) {
                    this.logger.debug(`Skipping ${config.platform} for Org ${config.orgId} (too soon since last sync)`);
                    continue;
                }

                /*
                  A connector parked at auth_failed has a dead or revoked token. Re-running
                  it every cycle cannot fix that — it just reproduces the same error (Slack's
                  `account_inactive` was logged on every pass) and buries real failures.
                  Reconnecting the integration clears the status and sync resumes.
                */
                if (connector?.status === AUTH_FAILED_STATUS) {
                    this.logger.debug(
                        `Skipping ${config.platform} for Org ${config.orgId} — connector is ${AUTH_FAILED_STATUS}; reconnect it to resume syncing.`,
                    );
                    continue;
                }

                await saasSyncService.syncPlatform(
                    config.platform,
                    config.orgId,
                    'system_worker',
                    'knowledge_store',
                    false,
                    { connectorId: config.connectorId }
                );

                // --- Daily Strategic Brief (Slack only) ---
                if (config.platform === 'slack') {
                    const [syncConfig] = await db.select()
                        .from(saasSyncConfigs)
                        .where(eq(saasSyncConfigs.connectorId, config.connectorId))
                        .limit(1);
                    
                    const lastBrief = syncConfig?.lastDailyBrief;
                    const isNewDay = !lastBrief || (new Date().toDateString() !== new Date(lastBrief).toDateString());

                    if (isNewDay) {
                        this.logger.info(`Sending Daily Strategic Brief for Org ${config.orgId}`);
                        const { conversationalBridgeService } = await import("../domain/integrations/conversational-bridge.service.js");
                        
                        // Use default channel from mappings or a fallback
                        const channelId = (syncConfig?.mappings as any)?.defaultChannelId || 'general';
                        
                        try {
                            await conversationalBridgeService.sendDailyBrief(channelId, config.orgId);
                            
                            // Update last sent time
                            await db.update(saasSyncConfigs)
                                .set({ lastDailyBrief: new Date() })
                                .where(eq(saasSyncConfigs.connectorId, config.connectorId));
                                
                            this.logger.info(`Daily Strategic Brief sent for Org ${config.orgId}`);
                        } catch (briefErr: any) {
                            this.logger.error(`Failed to send daily brief for Org ${config.orgId}: ${briefErr.message}`);
                        }
                    }
                }
                
                processed++;
            } catch (err: any) {
                this.logger.error(`Failed to auto-sync ${config.platform} for Org ${config.orgId}: ${err.message}`);
                failures++;

                // Park a permanently unauthorised connector so the next cycle skips it
                // instead of replaying the same failure indefinitely.
                if (isPermanentAuthFailure(err)) {
                    try {
                        await db.update(saasConnectors)
                            .set({ status: AUTH_FAILED_STATUS, updatedAt: new Date() })
                            .where(eq(saasConnectors.id, config.connectorId));
                        this.logger.error(
                            `${config.platform} connector for Org ${config.orgId} marked ${AUTH_FAILED_STATUS} ` +
                            `(${err.message}). Auto-sync is paused until the integration is reconnected.`,
                        );
                    } catch (markErr: any) {
                        this.logger.error(`Failed to mark ${config.platform} connector as ${AUTH_FAILED_STATUS}: ${markErr.message}`);
                    }
                }
            }
        }

        this.logger.info(`SaaS sync cycle complete. Processed: ${processed}, Failures: ${failures}`);
        return { processed, failures };
    }
}

let saasSyncWorker: SaaSSyncWorker | null = null;

export function startSaaSSyncWorker() {
    if (!saasSyncWorker) {
        saasSyncWorker = new SaaSSyncWorker();
    }
    return saasSyncWorker;
}

/**
 * Initialize the recurring job for the SaaS sync worker
 */
export async function initSaaSSyncScheduler() {
    const { Queue } = await import("bullmq");
    const { getRedisOptions } = await import("@domain/core/infrastructure/redis/redis-client.js");
    
    const saasSyncQueue = new Queue("saas-sync", {
        connection: getRedisOptions(),
    });

    // Run every 5 minutes to check which connectors need syncing (based on their own intervals)
    await saasSyncQueue.add('poll-saas-sync', {}, {
        repeat: {
            every: 300000, // 5 minutes
        },
        jobId: 'saas-sync-poll',
    });
}
