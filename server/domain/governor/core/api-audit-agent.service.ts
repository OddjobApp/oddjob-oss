
import { db } from "@server/database_service.js";
import { gatewayRequestLogs, saasConnectors } from "@shared/schema/index.js";
import { eq, sql, desc, gte } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";

const logger = createLogger("ApiAuditAgent");

export const apiAuditAgent = {
    /**
     * Analyzes recent API logs and generates recommendations or applies rules.
     */
    async audit(organizationId: number) {
        logger.info(`Running API Audit for organization ${organizationId}...`);

        // 1. Fetch recent logs (last 24 hours)
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentLogs = await db.select()
            .from(gatewayRequestLogs)
            .where(sql`${gatewayRequestLogs.organizationId} = ${organizationId} AND ${gatewayRequestLogs.createdAt} >= ${yesterday}`)
            .orderBy(desc(gatewayRequestLogs.createdAt))
            .limit(500);

        if (recentLogs.length === 0) {
            logger.info("No recent logs found for audit.");
            return;
        }

        // 2. Aggregate stats
        const stats = this._aggregateStats(recentLogs);

        // 3. AI Analysis
        const recommendations = await this._getAiRecommendations(stats, organizationId);

        // 4. Apply Rules (Simulated for now, would update governor policies)
        logger.info("API Audit Recommendations:", { recommendations });
        
        return recommendations;
    },

    _aggregateStats(logs: any[]) {
        const platforms: Record<string, any> = {};
        
        for (const log of logs) {
            if (!platforms[log.platform]) {
                platforms[log.platform] = {
                    totalRequests: 0,
                    successCount: 0,
                    errorCount: 0,
                    avgDuration: 0,
                    statusCodes: {},
                    errors: []
                };
            }
            
            const p = platforms[log.platform];
            p.totalRequests++;
            if (log.responseStatus && log.responseStatus < 400) {
                p.successCount++;
            } else {
                p.errorCount++;
                if (log.error) p.errors.push(log.error);
            }
            
            p.avgDuration = (p.avgDuration * (p.totalRequests - 1) + (log.durationMs || 0)) / p.totalRequests;
            
            if (log.responseStatus) {
                p.statusCodes[log.responseStatus] = (p.statusCodes[log.responseStatus] || 0) + 1;
            }
        }
        
        return platforms;
    },

    async _getAiRecommendations(stats: any, organizationId: number) {
        const aiConfig = await systemAiService.getAiConfig('governor', organizationId);
        if (!aiConfig) return "No governor AI configured.";

        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const systemPrompt = `You are the Oddjob API Governance Agent. 
Analyze the provided API execution statistics and identify patterns, bottlenecks, or limit issues.
Suggest specific rules to manage these calls more effectively (e.g., "Add 5s delay between Jira updates", "Switch to bulk fetch for GitHub").`;

        const userPrompt = `
API STATISTICS (Last 24h):
${JSON.stringify(stats, null, 2)}

Provide a concise report with findings and recommended rules.
`;

        const result = await aiClient.execute({
            model: aiConfig.model,
            systemPrompt,
            userPrompt,
            maxTokens: 1024
        } as any, undefined, aiConfig.apiKey || "");

        return result.output;
    }
};
