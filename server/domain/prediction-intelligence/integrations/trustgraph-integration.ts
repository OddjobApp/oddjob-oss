// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — TRUSTGRAPH INTEGRATION
// Exports predictions as edges in the Knowledge Graph / Trustgraph.
// ============================================================================

import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import type { Prediction } from "../prediction/types.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("TrustGraphIntegration");

export class TrustGraphIntegration {
    /**
     * Exports a prediction's top branch as an edge in the Trustgraph.
     */
    async exportPrediction(prediction: Prediction, orgContext: OrgContext): Promise<boolean> {
        logger.info(`[TrustGraph] Exporting prediction ${prediction.id} to Trustgraph`);

        const predicate = prediction.topPredicate;
        if (!predicate) {
            logger.warn(`[TrustGraph] Prediction ${prediction.id} has no top predicate. Skipping.`);
            return false;
        }

        try {
            // 1. Parse predicate into source and target (Simple heuristic for demo)
            // e.g., "user_will_click" -> source: "User", target: "Click", relation: "PREDICTS_WILL"
            const parts = predicate.split("_");
            const sourceName = parts[0] || "Entity";
            const targetName = parts[parts.length - 1] || "Outcome";
            const relation = `PREDICTS_${parts.slice(1, -1).join("_").toUpperCase() || "WILL"}`;

            // 2. Resolve or Create Source Node
            const sourceIds = await graphService.resolveEntitiesToNodeIds([sourceName], orgContext);
            let sourceId = sourceIds[0];
            if (!sourceId) {
                const node = await graphService.createNode({
                    name: sourceName,
                    label: "Entity",
                    properties: { description: "Auto-created from prediction" }
                } as any, orgContext);
                sourceId = node.id;
            }

            // 3. Resolve or Create Target Node
            const targetIds = await graphService.resolveEntitiesToNodeIds([targetName], orgContext);
            let targetId = targetIds[0];
            if (!targetId) {
                const node = await graphService.createNode({
                    name: targetName,
                    label: "Outcome",
                    properties: { description: "Auto-created from prediction" }
                } as any, orgContext);
                targetId = node.id;
            }

            // 4. Create Edge
            const edge = await graphService.createEdge({
                sourceNodeId: sourceId,
                targetNodeId: targetId,
                relation,
                weight: Math.round(prediction.confidence * 10), // Map 0-1 to 1-10
                properties: {
                    predictionId: prediction.id,
                    entropy: prediction.entropy,
                    source: "prediction-engine"
                }
            } as any, orgContext);

            logger.info(`[TrustGraph] Successfully created edge ${edge.id} for prediction ${prediction.id}`);
            return true;
        } catch (error: any) {
            logger.error(`[TrustGraph] Failed to export prediction ${prediction.id}`, error);
            return false;
        }
    }
}

export const trustGraphIntegration = new TrustGraphIntegration();
