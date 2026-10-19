// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — CAUSAL CHAIN INTEGRATION
// Maps the relationship chain: Hidden State -> Prediction -> Mission
// ============================================================================

import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CausalChainIntegration");

export class CausalChainIntegration {
    /**
     * Maps a full causal chain from state inference to prediction to mission execution.
     */
    async mapCausalChain(
        state: { topLabel: string; entropy: number },
        prediction: { id: string; topPredicate: string; confidence: number },
        missionId: string,
        orgContext: OrgContext
    ): Promise<boolean> {
        logger.info(`[CausalChain] Mapping chain for prediction ${prediction.id}`);

        try {
            // 1. Create/Resolve State Node
            const stateNodeName = `State: ${state.topLabel}`;
            const stateIds = await graphService.resolveEntitiesToNodeIds([stateNodeName], orgContext);
            let stateNodeId = stateIds[0];
            if (!stateNodeId) {
                const node = await graphService.createNode({
                    name: stateNodeName,
                    label: "HiddenState",
                    properties: { entropy: state.entropy }
                } as any, orgContext);
                stateNodeId = node.id;
            }

            // 2. Create/Resolve Prediction Node
            const predictionNodeName = `Prediction: ${prediction.topPredicate}`;
            const predIds = await graphService.resolveEntitiesToNodeIds([predictionNodeName], orgContext);
            let predNodeId = predIds[0];
            if (!predNodeId) {
                const node = await graphService.createNode({
                    name: predictionNodeName,
                    label: "Prediction",
                    properties: { confidence: prediction.confidence, predictionId: prediction.id }
                } as any, orgContext);
                predNodeId = node.id;
            }

            // 3. Resolve Mission Node (Assume it exists or search by missionId in properties)
            // For now, we search for a node with label 'Mission' and the missionId in data
            const missionNodes = await graphService.searchNodes(orgContext, {
                label: "Mission",
                query: missionId
            });
            let missionNodeId = missionNodes.nodes[0]?.id;

            if (!missionNodeId) {
                // Fallback: create a shell mission node if not found
                const node = await graphService.createNode({
                    name: `Mission: ${missionId}`,
                    label: "Mission",
                    missionId: missionId,
                    properties: { source: "prediction-trigger" }
                } as any, orgContext);
                missionNodeId = node.id;
            }

            // 4. Create Edge: State -> TRIGGERS_PREDICTION -> Prediction
            await graphService.createEdge({
                sourceNodeId: stateNodeId,
                targetNodeId: predNodeId,
                relation: "TRIGGERS_PREDICTION",
                weight: Math.round((1 - state.entropy) * 10), // Lower entropy = stronger link
                properties: { source: "prediction-engine" }
            } as any, orgContext);

            // 5. Create Edge: Prediction -> TRIGGERS_MISSION -> Mission
            await graphService.createEdge({
                sourceNodeId: predNodeId,
                targetNodeId: missionNodeId,
                relation: "TRIGGERS_MISSION",
                weight: Math.round(prediction.confidence * 10),
                properties: { source: "prediction-engine" }
            } as any, orgContext);

            logger.info(`[CausalChain] Successfully mapped causal chain for prediction ${prediction.id}`);
            return true;
        } catch (error: any) {
            logger.error(`[CausalChain] Failed to map causal chain`, error);
            return false;
        }
    }
}

export const causalChainIntegration = new CausalChainIntegration();
