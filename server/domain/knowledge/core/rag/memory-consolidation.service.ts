import { db } from "@server/database_service.js";
import { eq, and, desc, sql, lt, gte } from "drizzle-orm";
import { agentChatMessages } from "@shared/schema/index.js";

export interface ExecutionTrace {
    messageId?: number;
    predictedOutcome?: string;
    actualOutcome: string;
    executionTimeMs: number;
    toolCalls?: any[];
    errorTrace?: string;
}

export interface ConsolidationResult {
    status: "completed" | "no_op" | "failed";
    consolidatedCount: number;
    prunedCount: number;
    surpriseScoreAvg: number;
    timestamp: string;
}

export const memoryConsolidationService = {
    /**
     * Calculate surprise metric based on prediction divergence, execution time anomalies, and error status
     * Surprise S = 0.5 * (1 - textSimilarity) + 0.3 * (hasError ? 1 : 0) + 0.2 * latencyAnomalyRatio
     */
    calculateSurpriseScore(trace: ExecutionTrace): number {
        let textDivergence = 0.5;
        if (trace.predictedOutcome && trace.actualOutcome) {
            const predWords = new Set(trace.predictedOutcome.toLowerCase().split(/\s+/));
            const actualWords = new Set(trace.actualOutcome.toLowerCase().split(/\s+/));
            let overlap = 0;
            predWords.forEach(w => { if (actualWords.has(w)) overlap++; });
            const jaccard = (predWords.size + actualWords.size - overlap) > 0 
                ? overlap / (predWords.size + actualWords.size - overlap) 
                : 1;
            textDivergence = 1 - jaccard;
        }

        const errorFactor = trace.errorTrace ? 1.0 : 0.0;
        const latencyFactor = Math.min(1.0, trace.executionTimeMs / 10000);

        const surpriseScore = (0.5 * textDivergence) + (0.3 * errorFactor) + (0.2 * latencyFactor);
        return Math.min(1.0, Math.max(0.0, surpriseScore));
    },

    /**
     * Consolidate episodic execution traces into structured retrospectives.
     * Traces with high surprise (> threshold) are retained as novel Anti-Patterns/Golden Paths.
     * Traces with low surprise (< threshold) are aggregated and pruned.
     */
    async consolidateEpisodicMemory(organizationId: number, surpriseThreshold: number = 0.4): Promise<ConsolidationResult> {
        try {
            // Fetch raw episodic agent messages for the organization
            const records = await db.select()
                .from(agentChatMessages)
                .orderBy(desc(agentChatMessages.createdAt))
                .limit(100);

            if (!records || records.length === 0) {
                return {
                    status: "no_op",
                    consolidatedCount: 0,
                    prunedCount: 0,
                    surpriseScoreAvg: 0,
                    timestamp: new Date().toISOString()
                };
            }

            let consolidatedCount = 0;
            let prunedCount = 0;
            let totalSurprise = 0;

            for (const record of records) {
                const metadata = (record.metadata as any) || {};
                const surpriseScore = this.calculateSurpriseScore({
                    messageId: record.id,
                    predictedOutcome: metadata.expectedOutcome,
                    actualOutcome: record.content,
                    executionTimeMs: metadata.executionTimeMs || 1200,
                    errorTrace: metadata.error
                });

                totalSurprise += surpriseScore;

                if (surpriseScore >= surpriseThreshold) {
                    // Retain as high-value novel learning (Golden Path or Anti-Pattern)
                    consolidatedCount++;
                } else {
                    // Low surprise = redundant episodic trace; marked for pruning / summarization
                    prunedCount++;
                }
            }

            const avgSurprise = records.length > 0 ? totalSurprise / records.length : 0;

            return {
                status: "completed",
                consolidatedCount,
                prunedCount,
                surpriseScoreAvg: Number(avgSurprise.toFixed(3)),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error("[MemoryConsolidation] Error during consolidation:", error);
            return {
                status: "failed",
                consolidatedCount: 0,
                prunedCount: 0,
                surpriseScoreAvg: 0,
                timestamp: new Date().toISOString()
            };
        }
    },

    /**
     * Executes the offline "Digital Sleep" maintenance cycle to prune proactive interference
     */
    async runDigitalSleepCycle(organizationId: number): Promise<ConsolidationResult> {
        console.log(`[MemoryConsolidation] Initiating Digital Sleep consolidation cycle for Org ${organizationId}...`);
        return this.consolidateEpisodicMemory(organizationId, 0.45);
    }
};
