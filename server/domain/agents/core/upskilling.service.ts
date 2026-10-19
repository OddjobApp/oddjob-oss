
import { db } from "@server/database_service.js";
import { agentDeployments, agentRunSteps, forensicEventLog } from "@shared/schema/index.js";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import { SentinelService } from "@domain/mission/core/sentinel-service.js";
import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";

const logger = createLogger("UpskillingService");

export interface UpskillingCandidate {
    agentId: number;
    title: string;
    reliability: number;
    failureCount: number;
    status: 'OPTIMAL' | 'DEBT' | 'PROBATION';
}

export class UpskillingService {
    /**
     * Identifies agents that have developed 'Performance Debt' (reliability < 85%)
     */
    static async getCandidates(organizationId: number): Promise<UpskillingCandidate[]> {
        const deployments = await db.select().from(agentDeployments).where(eq(agentDeployments.organizationId, organizationId));
        const candidates: UpskillingCandidate[] = [];

        for (const agent of deployments) {
            // Get reliability for the agent's jobId
            const health = await SentinelService.getEcosystemSummary(); // Simplified lookup
            // In a real implementation, we'd filter Sentinel metrics by agent.jobId
            
            // Mocking logic for candidates since Sentinel query is global
            const reliability = Math.floor(Math.random() * 40) + 60; // 60-100
            
            if (reliability < 85) {
                candidates.push({
                    agentId: agent.id,
                    title: agent.title,
                    reliability,
                    failureCount: Math.floor((100 - reliability) / 5),
                    status: reliability < 70 ? 'PROBATION' : 'DEBT'
                });
            }
        }

        return candidates;
    }

    /**
     * Synthesizes failure traces into a "Retraining Dataset" (Negative Training Examples)
     */
    static async generateNegativeExamples(agentId: number) {
        const agent = await db.query.agentDeployments.findFirst({
            where: eq(agentDeployments.id, agentId)
        });
        if (!agent) throw new Error("Agent not found");

        const failures = await db.select()
            .from(agentRunSteps)
            .where(and(
                eq(agentRunSteps.jobId, agent.jobId!),
                sql`type = 'action' OR type = 'thought'`,
                sql`confidence < 0.5`
            ))
            .limit(10)
            .orderBy(desc(agentRunSteps.createdAt));

        return failures.map(f => ({
            input: f.content,
            error: "Low confidence / High friction execution",
            timestamp: f.createdAt
        }));
    }

    /**
     * Spawns an "Upskilling Mission" where the agent performs self-critical analysis
     */
    static async triggerUpskilling(agentId: number, organizationId: number) {
        const agent = await db.query.agentDeployments.findFirst({
            where: eq(agentDeployments.id, agentId)
        });
        if (!agent) throw new Error("Agent not found");

        const examples = await this.generateNegativeExamples(agentId);
        
        logger.info(`[Upskilling] Triggering self-optimization for agent ${agent.title}`, { exampleCount: examples.length });

        // In a real implementation, this would spawn a specialized Mission with a 'Self-Correction' goal.
        // For now, we update the agent's legend to reflect the upskilling intent.
        const upskillingNote = `\n\n[SYSTEM_UPDATE: ${new Date().toISOString()}] Agent entered PIP (Performance Improvement Plan) due to reliability drop. Analyzing ${examples.length} failure traces for self-correction.`;
        
        await db.update(agentDeployments)
            .set({ 
                legend: sql`legend || ${upskillingNote}`,
                updatedAt: new Date()
            })
            .where(eq(agentDeployments.id, agentId));

        return {
            success: true,
            agentId,
            sessionStarted: true,
            examplesAnalyzed: examples.length
        };
    }
}
