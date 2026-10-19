import { db } from "@server/database_service.js";
import { integrationLogs, type InsertIntegrationLog } from "@shared/schema/system.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("IntegrationTelemetry");

export interface TelemetryLogOptions {
    platform: string;
    action?: string;
    method: string;
    url: string;
    requestHeaders?: any;
    requestBody?: any;
    responseStatus?: number;
    responseBody?: any;
    error?: string;
    durationMs?: number;
    organizationId?: number | null;
    userId?: string | null;
    
    // Telemetry additions
    rateLimitLimit?: number;
    rateLimitRemaining?: number;
    rateLimitReset?: Date;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    costUsd?: string;
    traceId?: string;
    missionId?: number | null;
    isPriority?: boolean;
}

export const integrationTelemetryService = {
    /**
     * Log an integration call to the unified telemetry table
     */
    async logCall(options: TelemetryLogOptions): Promise<void> {
        try {
            const entry: InsertIntegrationLog = {
                platform: options.platform,
                action: options.action,
                method: options.method,
                url: options.url,
                requestHeaders: options.requestHeaders,
                requestBody: options.requestBody,
                responseStatus: options.responseStatus,
                responseBody: options.responseBody,
                error: options.error,
                durationMs: options.durationMs,
                organizationId: options.organizationId,
                userId: options.userId,
                
                // Enhanced Telemetry
                rateLimitLimit: options.rateLimitLimit,
                rateLimitRemaining: options.rateLimitRemaining,
                rateLimitReset: options.rateLimitReset,
                model: options.model,
                promptTokens: options.promptTokens,
                completionTokens: options.completionTokens,
                costUsd: options.costUsd,
                traceId: options.traceId,
                missionId: options.missionId,
                isPriority: options.isPriority ?? false,
                
                createdAt: new Date()
            };

            await db.insert(integrationLogs).values(entry);
        } catch (err) {
            // We don't want telemetry failures to crash the main process
            logger.error("Failed to log integration telemetry:", err as Error, { platform: options.platform });
        }
    }
};

export default integrationTelemetryService;
