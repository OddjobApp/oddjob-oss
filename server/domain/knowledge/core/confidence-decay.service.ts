import { db } from "@server/database_service.js";
import { knowledgeNodes } from "@shared/schema/index.js";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("confidence-decay-service");

// The decay constant (lambda). 
// Example: lambda = 0.01 per day means ~30% decay over 30 days.
// You can adjust this based on the volatility of different node labels.
const DEFAULT_DECAY_RATE_PER_DAY = 0.01;

export const confidenceDecayService = {
    /**
     * Applies the decay function to all applicable knowledge nodes.
     * C(t) = C_initial * e^(-lambda * t)
     * where t is the number of days since last reaffirmation or verification
     */
    async applyDecay() {
        logger.info("Starting confidence decay calculation...");

        try {
            // Find nodes that have an initial confidence score and a verifiedAt/lastReaffirmedAt timestamp
            const nodes = await db.select({
                id: knowledgeNodes.id,
                initialConfidenceScore: knowledgeNodes.initialConfidenceScore,
                lastReaffirmedAt: knowledgeNodes.lastReaffirmedAt,
                verifiedAt: knowledgeNodes.verifiedAt,
                createdAt: knowledgeNodes.createdAt,
            }).from(knowledgeNodes)
                .where(
                    isNotNull(knowledgeNodes.initialConfidenceScore)
                );

            let updatedCount = 0;
            const now = new Date();

            for (const node of nodes) {
                // Determine the base timestamp to calculate elapsed time from
                const baseTime = node.lastReaffirmedAt || node.verifiedAt || node.createdAt || now;
                const elapsedMs = now.getTime() - baseTime.getTime();
                const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

                if (elapsedDays <= 0 || !node.initialConfidenceScore) {
                    continue;
                }

                const initialScore = parseFloat(node.initialConfidenceScore as string);

                // Calculate decayed score
                const decayedScore = initialScore * Math.exp(-DEFAULT_DECAY_RATE_PER_DAY * elapsedDays);

                // Ensure two decimal places to match schema (precision 3, scale 2 implies up to 1.00)
                let finalScore = Math.max(0, Math.min(1, Number(decayedScore.toFixed(2))));

                await db.update(knowledgeNodes)
                    .set({ confidenceScore: finalScore.toString() })
                    .where(eq(knowledgeNodes.id, node.id));

                updatedCount++;
            }

            logger.info(`Successfully applied confidence decay to ${updatedCount} nodes.`);
            return { success: true, updatedCount };
        } catch (error: any) {
            logger.error("Failed to apply confidence decay", { error: error.message });
            return { success: false, error: error.message };
        }
    },

    /**
     * Reaffirms a node's confidence, setting its lastReaffirmedAt to now
     * and resetting its current confidence back to its initial score (or 1.0 if not set).
     */
    async reaffirmNode(nodeId: number, userId: string = "system") {
        try {
            const nodeResult = await db.select({
                initialScore: knowledgeNodes.initialConfidenceScore,
                currentScore: knowledgeNodes.confidenceScore
            })
                .from(knowledgeNodes)
                .where(eq(knowledgeNodes.id, nodeId));

            if (nodeResult.length === 0) {
                throw new Error(`Node ${nodeId} not found`);
            }

            const node = nodeResult[0];
            const newScore = node.initialScore || "1.00";

            await db.update(knowledgeNodes)
                .set({
                    confidenceScore: newScore.toString(),
                    lastReaffirmedAt: new Date(),
                    verifiedBy: userId,
                })
                .where(eq(knowledgeNodes.id, nodeId));

            return { success: true, restoredScore: newScore };
        } catch (error: any) {
            logger.error(`Failed to reaffirm node ${nodeId}`, { error: error.message });
            return { success: false, error: error.message };
        }
    }
};


