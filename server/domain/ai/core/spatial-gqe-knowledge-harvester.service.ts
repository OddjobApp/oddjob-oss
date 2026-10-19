import { createLogger } from "@server/utils/logger.js";
import { GoodQuestionEngine, StructuredQuestionPayload } from "./good-question-engine.js";
import { SpatialSurpriseResult } from "./spatial-surprise-evaluator.service.js";
import type { TrajectoryEvaluationResult } from "./prediction-engine.service.js";

const logger = createLogger("SpatialGqeKnowledgeHarvester");

export interface RegionalDomainKnowledgeNode {
    id: string;
    h3Index: string;
    parentRes3: string;
    sectorTopicId: string;
    sectorTopicName: string;
    harvestedFact: string;
    confidenceScore: number;
    sourceUserId?: number;
    createdAt: string;
}

export interface GqeSpatialMiningCard {
    h3Index: string;
    sectorTopicId: string;
    surpriseScoreError: number;
    gqeFormPayload: StructuredQuestionPayload;
    status: 'PENDING_EXPERT_INPUT' | 'HARVESTED' | 'DISMISSED';
}

/**
 * Spatial GQE Active Knowledge Harvester Service:
 * Couples the Good Question Engine (GQE) with spatial surprise triggers (ε > 0.25)
 * to harvest high-value regional domain ground truth and persist structured Knowledge Nodes.
 */
export class SpatialGqeKnowledgeHarvesterService {
    private static knowledgeGraphStore: RegionalDomainKnowledgeNode[] = [];

    /**
     * Generates an upfront GQE FormAgent Card when spatial surprise or flux threshold is breached.
     */
    public static generateMiningCard(
        surpriseResult: SpatialSurpriseResult,
        sectorTopicId: string,
        sectorTopicName: string
    ): GqeSpatialMiningCard {
        /*
          generateStructuredQuestion takes a TrajectoryEvaluationResult; the
          object here was shaped as recommendedPathId / overallConfidence /
          stepScores, which is not that type. The same intent is expressed on
          the real fields — a surprising region is worth a look but not an
          autonomous action, hence require_approval.
        */
        const evaluation: TrajectoryEvaluationResult = {
            safeTransitionScore: 0.85,
            probabilitySuccess: 0.88,
            blastRadius: 0,
            loopDetected: false,
            recommendedAction: "require_approval",
            selectedModelTier: "frontier_large",
            costReductionEst: "0%",
            reason: `Spatial Surprise ε = ${surpriseResult.surpriseScoreError} in H3 [${surpriseResult.h3Index}]`,
        };

        const gqeFormPayload = GoodQuestionEngine.generateStructuredQuestion({
            stage: "Diagnose",
            targetNodeOrFile: surpriseResult.h3Index,
            evaluationResult: evaluation
        });

        // Tailor FormAgent title and options for regional domain mining
        gqeFormPayload.formAgentPayload.title = `🧠 Regional Knowledge Mining: ${sectorTopicName} (${surpriseResult.h3Index.slice(0, 7)})`;
        gqeFormPayload.formAgentPayload.minimalProofContext = {
            spatialSurprise: `Prediction Error ε = ${surpriseResult.surpriseScoreError}. Observed risk Φ = ${surpriseResult.observedRiskPhi} vs Expected Φ = ${surpriseResult.expectedRiskPhi}.`
        };

        gqeFormPayload.formAgentPayload.socraticDisambiguationOptions = [
            {
                optionId: "opt_infrastructure_outage",
                label: "Local Infrastructure Failure",
                description: `Substation/Port facility offline in H3 cell ${surpriseResult.h3Index.slice(0, 7)}`,
                riskScore: 0.15
            },
            {
                optionId: "opt_regulatory_restriction",
                label: "Regulatory / Permit Restriction",
                description: `Emergency curfew or municipal permit block active in this zone`,
                riskScore: 0.25
            },
            {
                optionId: "opt_weather_hazard",
                label: "Environmental / High Tide Event",
                description: `Localized flood/storm surge causing temporary operational halt`,
                riskScore: 0.10
            }
        ];

        logger.info(
            `[SpatialGqeKnowledgeHarvester] Generated GQE Mining Card for H3 [${surpriseResult.h3Index}] / Topic '${sectorTopicName}'.`
        );

        return {
            h3Index: surpriseResult.h3Index,
            sectorTopicId,
            surpriseScoreError: surpriseResult.surpriseScoreError,
            gqeFormPayload,
            status: 'PENDING_EXPERT_INPUT'
        };
    }

    /**
     * Persists human expert response into the Regional Domain Knowledge Store.
     */
    public static harvestExpertResponse(
        h3Index: string,
        sectorTopicId: string,
        sectorTopicName: string,
        selectedOptionLabel: string,
        userId?: number
    ): RegionalDomainKnowledgeNode {
        const node: RegionalDomainKnowledgeNode = {
            id: `knode_${Date.now()}`,
            h3Index,
            parentRes3: h3Index.slice(0, 5),
            sectorTopicId,
            sectorTopicName,
            harvestedFact: `Verified Regional Factor: ${selectedOptionLabel}`,
            confidenceScore: 0.95,
            sourceUserId: userId,
            createdAt: new Date().toISOString()
        };

        this.knowledgeGraphStore.push(node);
        logger.info(
            `[SpatialGqeKnowledgeHarvester] Harvested Knowledge Node '${node.id}' for H3 [${h3Index}] / Sector '${sectorTopicName}'. Total Nodes: ${this.knowledgeGraphStore.length}`
        );

        return node;
    }

    /**
     * Retrieves all harvested regional domain knowledge nodes for an H3 cell.
     */
    public static getKnowledgeForH3(h3Index: string): RegionalDomainKnowledgeNode[] {
        return this.knowledgeGraphStore.filter(n => n.h3Index === h3Index);
    }
}
