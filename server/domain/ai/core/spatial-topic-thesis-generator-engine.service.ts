import { createLogger } from "@server/utils/logger.js";
import { H3EigenvalueResult } from "./h3-eigenvalue-spectral-engine.service.js";
import { InterZoneDivergenceResult } from "./h3-interzone-topic-divergence-engine.service.js";

const logger = createLogger("SpatialTopicThesisGeneratorEngine");

export interface SpatialTopicConcept {
    conceptId: string;
    conceptTitle: string;
    h3Cluster: string[];
    primaryTopic: string;
    secondaryTopic: string;
    spatialDriftDirectionDeg: number; // PCA Principal Angle theta
    anisotropyRatio: number;         // Eccentricity e
}

export interface StrategicSpatialThesis {
    thesisId: string;
    thesisTitle: string;
    abstractSummary: string;
    underlyingConcept: SpatialTopicConcept;
    testableHypothesis: string;
    confidenceScore: number; // [0.0 to 1.0]
    expectedImpactPhi: number;
    recommendedActions: string[];
    createdAt: string;
}

/**
 * Spatial-Topic Thesis Generator Engine:
 * Formulates autonomous concepts and proposes strategic hypotheses/theses by synthesizing
 * spatial PCA eigenvalue vectors, Gaussian kernel generalization fields, and inter-zone JS topic divergence.
 */
export class SpatialTopicThesisGeneratorEngineService {
    /**
     * Synthesizes spatial eigenvalue data and inter-zone topic divergence into a structured Strategic Thesis.
     */
    public static proposeStrategicThesis(
        eigenvalueResult: H3EigenvalueResult,
        divergenceResult: InterZoneDivergenceResult,
        clusterH3Indices: string[]
    ): StrategicSpatialThesis {
        const startTime = performance.now();
        const timestamp = new Date().toISOString();

        // 1. Synthesize Spatial-Topic Concept
        const conceptId = `concept_${Date.now()}`;
        const conceptTitle = `${divergenceResult.dominantTopicA} ➔ ${divergenceResult.dominantTopicB} Spatial Corridor Shift`;

        const concept: SpatialTopicConcept = {
            conceptId,
            conceptTitle,
            h3Cluster: clusterH3Indices,
            primaryTopic: divergenceResult.dominantTopicA,
            secondaryTopic: divergenceResult.dominantTopicB,
            spatialDriftDirectionDeg: eigenvalueResult.principalAngleDeg,
            anisotropyRatio: eigenvalueResult.eccentricity
        };

        // 2. Generate Strategic Thesis & Testable Hypothesis
        const thesisId = `thesis_spatial_${Date.now()}`;
        const thesisTitle = `Strategic Thesis: ${conceptTitle} along ${eigenvalueResult.principalAngleDeg}° Axis`;

        const abstractSummary =
            `Analysis of H3 cluster [${clusterH3Indices.slice(0, 3).join(", ")}] reveals high inter-zone topic divergence (D_JS = ${divergenceResult.jsDivergenceScore}) between '${divergenceResult.dominantTopicA}' and '${divergenceResult.dominantTopicB}'. ` +
            `Principal Component Analysis demonstrates strong directional risk anisotropy (e = ${eigenvalueResult.eccentricity}) aligned along a ${eigenvalueResult.principalAngleDeg}° axis.`;

        const testableHypothesis =
            `Operational friction in H3 zone [${divergenceResult.h3IndexA.slice(0, 7)}] under topic '${divergenceResult.dominantTopicA}' is driving a directional risk spillover along ${eigenvalueResult.principalAngleDeg}° into adjacent zone [${divergenceResult.h3IndexB.slice(0, 7)}] under topic '${divergenceResult.dominantTopicB}'.`;

        // 3. Compute Thesis Confidence Score based on Eigenvalue Variance and JS Divergence
        const confidenceScore = Number(
            (0.50 + 0.30 * eigenvalueResult.eccentricity + 0.20 * Math.min(1, divergenceResult.jsDivergenceScore)).toFixed(2)
        );

        const expectedImpactPhi = Number(
            (0.40 + 0.50 * Math.min(1, divergenceResult.jsDivergenceScore)).toFixed(2)
        );

        const recommendedActions = [
            `Pre-stage regional buffers along the ${eigenvalueResult.principalAngleDeg}° expansion corridor`,
            `Deploy GQE Active Knowledge Harvester for H3 cell ${divergenceResult.h3IndexA.slice(0, 7)}`,
            `Enforce automated governance gate (${divergenceResult.isHighDivergenceBoundary ? 'HUMAN_GATED' : 'AUTO_APPROVED'})`
        ];

        const latencyMs = Number((performance.now() - startTime).toFixed(2));

        logger.info(
            `[SpatialTopicThesisGeneratorEngine] Formulated Thesis '${thesisId}' (${thesisTitle}) with Confidence ${confidenceScore} in ${latencyMs}ms.`
        );

        return {
            thesisId,
            thesisTitle,
            abstractSummary,
            underlyingConcept: concept,
            testableHypothesis,
            confidenceScore,
            expectedImpactPhi,
            recommendedActions,
            createdAt: timestamp
        };
    }
}
