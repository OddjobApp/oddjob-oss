import { createLogger } from "@server/utils/logger.js";
import { SpatialGqeKnowledgeHarvesterService, GqeSpatialMiningCard } from "./spatial-gqe-knowledge-harvester.service.ts";

const logger = createLogger("H3InterZoneTopicDivergenceEngine");

export interface H3ZoneTopicProfile {
    h3Index: string;
    zoneName: string;
    topicProbabilities: Record<string, number>; // { 'logistics': 0.70, 'zoning': 0.20, 'tech': 0.10 }
}

export interface InterZoneDivergenceResult {
    h3IndexA: string;
    h3IndexB: string;
    jsDivergenceScore: number; // Jensen-Shannon Divergence [0.0 to 1.0]
    dominantTopicA: string;
    dominantTopicB: string;
    isHighDivergenceBoundary: boolean; // jsDivergenceScore > 0.30
    miningCard?: GqeSpatialMiningCard;
}

/**
 * H3 Inter-Zone Topic Divergence Engine:
 * Calculates Jensen-Shannon (JS) Topic Divergence across adjacent H3 cell boundaries:
 *
 *   D_JS(P_A || P_B) = 0.5 * D_KL(P_A || M) + 0.5 * D_KL(P_B || M)
 *
 * Automatically detects sharp semantic topic shifts between neighboring geographic zones
 * and triggers targeted GQE boundary domain questions.
 */
export class H3InterZoneTopicDivergenceEngineService {
    /**
     * Calculates Kullback-Leibler (KL) Divergence D_KL(P || Q).
     */
    private static calculateKlDivergence(P: number[], Q: number[]): number {
        let kl = 0;
        for (let i = 0; i < P.length; i++) {
            const p = Math.max(1e-6, P[i]);
            const q = Math.max(1e-6, Q[i]);
            kl += p * Math.log2(p / q);
        }
        return Math.max(0, kl);
    }

    /**
     * Computes Symmetric Jensen-Shannon (JS) Topic Divergence between two H3 zones.
     */
    public static computeZoneTopicDivergence(
        zoneA: H3ZoneTopicProfile,
        zoneB: H3ZoneTopicProfile
    ): InterZoneDivergenceResult {
        const startTime = performance.now();

        // 1. Align topic vocabulary key set
        const topicKeys = Array.from(
            new Set([...Object.keys(zoneA.topicProbabilities), ...Object.keys(zoneB.topicProbabilities)])
        );

        const pA = topicKeys.map(k => zoneA.topicProbabilities[k] || 0);
        const pB = topicKeys.map(k => zoneB.topicProbabilities[k] || 0);

        // Normalize distributions to sum to 1
        const sumA = pA.reduce((a, b) => a + b, 0) || 1;
        const sumB = pB.reduce((a, b) => a + b, 0) || 1;
        const normA = pA.map(v => v / sumA);
        const normB = pB.map(v => v / sumB);

        // 2. Compute Mean Distribution M = (P_A + P_B) / 2
        const normM = normA.map((val, i) => 0.5 * (val + normB[i]));

        // 3. JS Divergence = 0.5 * D_KL(P_A || M) + 0.5 * D_KL(P_B || M)
        const klA = this.calculateKlDivergence(normA, normM);
        const klB = this.calculateKlDivergence(normB, normM);
        const jsDivergenceScore = Number((0.5 * klA + 0.5 * klB).toFixed(3));

        // 4. Identify dominant topic per zone
        const dominantTopicA = topicKeys[normA.indexOf(Math.max(...normA))] || "General";
        const dominantTopicB = topicKeys[normB.indexOf(Math.max(...normB))] || "General";

        const isHighDivergenceBoundary = jsDivergenceScore > 0.30;

        let miningCard: GqeSpatialMiningCard | undefined;
        if (isHighDivergenceBoundary) {
            // Trigger GQE Mining Card tailored for Boundary Topic Divergence
            miningCard = SpatialGqeKnowledgeHarvesterService.generateMiningCard(
                {
                    h3Index: zoneA.h3Index,
                    expectedRiskPhi: 0.20,
                    observedRiskPhi: 0.75,
                    surpriseScoreError: jsDivergenceScore,
                    isSurpriseThresholdBreached: true,
                    severity: 'HIGH',
                    evaluationTimestamp: new Date().toISOString(),
                    policyOutcome: 'HUMAN_GATED'
                },
                `${dominantTopicA}_vs_${dominantTopicB}`,
                `Inter-Zone Topic Shift: ${dominantTopicA} ➔ ${dominantTopicB}`
            );

            miningCard.gqeFormPayload.formAgentPayload.title = `🌉 Boundary Knowledge Mining: H3 [${zoneA.h3Index.slice(0, 7)}] ➔ [${zoneB.h3Index.slice(0, 7)}]`;
            miningCard.gqeFormPayload.formAgentPayload.minimalProofContext = {
                topicDivergence: `JS Divergence D_JS = ${jsDivergenceScore}. Zone A is dominated by [${dominantTopicA}], while Zone B shifts to [${dominantTopicB}].`
            };
        }

        const latencyMs = Number((performance.now() - startTime).toFixed(2));

        logger.info(
            `[H3InterZoneTopicDivergenceEngine] Evaluated D_JS(${zoneA.h3Index} || ${zoneB.h3Index}) = ${jsDivergenceScore} (${dominantTopicA} vs ${dominantTopicB}) in ${latencyMs}ms.`
        );

        return {
            h3IndexA: zoneA.h3Index,
            h3IndexB: zoneB.h3Index,
            jsDivergenceScore,
            dominantTopicA,
            dominantTopicB,
            isHighDivergenceBoundary,
            miningCard
        };
    }
}
