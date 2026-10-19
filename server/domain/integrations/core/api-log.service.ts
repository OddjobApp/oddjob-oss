
import { db } from "@server/database_service.js";
import { gatewayRequestLogs } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ApiLogService");

export const apiLogService = {
    async log(data: {
        platform: string;
        action: string;
        method: string;
        url: string;
        requestHeaders?: any;
        requestBody?: any;
        responseStatus?: number;
        responseHeaders?: any;
        responseBody?: any;
        durationMs?: number;
        organizationId?: number | null;
        error?: string;
    }) {
        try {
            await db.insert(gatewayRequestLogs).values({
                platform: data.platform,
                action: data.action,
                method: data.method,
                url: data.url,
                requestHeaders: data.requestHeaders,
                requestBody: data.requestBody,
                responseStatus: data.responseStatus,
                responseHeaders: data.responseHeaders,
                responseBody: data.responseBody,
                durationMs: data.durationMs,
                organizationId: data.organizationId,
                error: data.error,
                createdAt: new Date(),
            });
        } catch (err) {
            logger.warn("Failed to save gateway log", { error: err });
        }
    }
};
