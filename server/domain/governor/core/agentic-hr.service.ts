
import { db } from "@server/database_service.js";
import { agentPips, agentConductLogs, agentToolUsage } from "@shared/schema/index.js";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { MoltProducer } from "./molt-producer.js";

const logger = createLogger("AgenticHRService");

export class AgenticHRService {
    /**
     * Periodic scan of agent performance to detect potential PIP candidates.
     */
    static async monitorPerformance(orgId: number) {
        logger.info(`Starting Agentic HR performance audit for org ${orgId}`);

        // 1. Get failure rates per agent in the last 24h
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);

        const stats = await db.select({
            agentId: agentToolUsage.agentRunId, // Assuming agentRunId links to agent identity here
            totalCalls: sql<number>`count(*)`,
            failedCalls: sql<number>`count(*) filter (where status = 'error' or status = 'timeout')`
        })
        .from(agentToolUsage)
        .where(and(
            eq(agentToolUsage.organizationId, orgId),
            gte(agentToolUsage.createdAt, yesterday)
        ))
        .groupBy(agentToolUsage.agentRunId);

        for (const row of stats) {
            if (!row.agentId) continue;
            
            const errorRate = row.failedCalls / row.totalCalls;
            logger.debug(`Agent ${row.agentId} error rate: ${(errorRate * 100).toFixed(1)}%`);

            if (errorRate > 0.4 && row.totalCalls > 5) {
                await this.triggerPIP(row.agentId, orgId, errorRate, "Excessive tool failure rate detected during autonomous execution.");
            }
        }
    }

    /**
     * Triggers a Performance Improvement Plan (PIP) for an agent.
     */
    static async triggerPIP(agentId: number, orgId: number, errorRate: number, reason: string) {
        // Check if already in PIP
        const [existing] = await db.select().from(agentPips).where(and(
            eq(agentPips.agentId, agentId),
            eq(agentPips.status, 'active')
        ));

        if (existing) return;

        logger.warn(`[HR] Triggering PIP for Agent ${agentId} (Error Rate: ${(errorRate * 100).toFixed(1)}%)`);

        await db.insert(agentPips).values({
            agentId,
            organizationId: orgId,
            reason,
            currentErrorRate: errorRate,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 day review
        });

        await db.insert(agentConductLogs).values({
            agentId,
            type: 'ERROR_SPIKE',
            severity: 'critical',
            description: `Performance PIP triggered due to ${(errorRate * 100).toFixed(1)}% error rate. ${reason}`
        });

        // Notify the Board (Molt)
        const producer = new MoltProducer(`hr_pip_${agentId}`, orgId);
        await producer.publish('SIG_PIP_TRIGGERED', {
            agentId,
            errorRate,
            reason,
            action: "MANDATORY_UPSKILLING_REVIEW"
        });
    }

    /**
     * Recommended upskilling (e.g. fine-tuning recommendation).
     */
    static async recommendUpskilling(agentId: number) {
        // Logic to link to Feature 9 (Fine-Tuning Pipe)
        return {
            recommendation: "LO_RA_RE_TRAINING",
            datasetTopic: "Tool Error Correction",
            estimatedImprovement: "15-20%"
        };
    }
}
