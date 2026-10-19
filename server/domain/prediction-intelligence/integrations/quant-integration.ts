// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — QUANT INTEGRATION
// Maps the relationship chain: Prediction -> Supporting Quants
// ============================================================================

import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("QuantIntegration");

export class QuantIntegration {
    /**
     * Maps supporting quants to a prediction in the Trustgraph.
     */
    async mapQuants(
        predictionId: string,
        predictionLabel: string,
        quants: Array<{ id: string; label: string; value: number }>,
        orgContext: OrgContext
    ): Promise<boolean> {
        logger.info(`[QuantIntegration] Mapping ${quants.length} quants for prediction ${predictionId}`);

        try {
            // 1. Resolve Prediction Node
            const predictionNodeName = `Prediction: ${predictionLabel}`;
            const predIds = await graphService.resolveEntitiesToNodeIds([predictionNodeName], orgContext);
            let predNodeId = predIds[0];
            if (!predNodeId) {
                const node = await graphService.createNode({
                    name: predictionNodeName,
                    label: "Prediction",
                    properties: { predictionId }
                } as any, orgContext);
                predNodeId = node.id;
            }

            // 2. Map Quants
            for (const quant of quants) {
                // Resolve Quant Node
                const quantNodeName = `Quant: ${quant.label}`;
                const quantIds = await graphService.resolveEntitiesToNodeIds([quantNodeName], orgContext);
                let quantNodeId = quantIds[0];
                if (!quantNodeId) {
                    const node = await graphService.createNode({
                        name: quantNodeName,
                        label: "Quant",
                        properties: { quantId: quant.id, value: quant.value }
                    } as any, orgContext);
                    quantNodeId = node.id;
                }

                // Create Edge: Prediction -> SUPPORTED_BY -> Quant
                await graphService.createEdge({
                    sourceNodeId: predNodeId,
                    targetNodeId: quantNodeId,
                    relation: "SUPPORTED_BY",
                    weight: Math.round(quant.value * 10), // Scale 0-1 value to 0-10 weight
                    properties: { source: "prediction-engine" }
                } as any, orgContext);
            }

            logger.info(`[QuantIntegration] Successfully mapped quants for prediction ${predictionId}`);
            return true;
        } catch (error: any) {
            logger.error(`[QuantIntegration] Failed to map quants`, error);
            return false;
        }
    }
}

export const quantIntegration = new QuantIntegration();
