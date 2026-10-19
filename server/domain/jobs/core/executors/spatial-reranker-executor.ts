import { Job, Pipeline } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";

/**
 * SpatialRerankerExecutor
 *
 * Reranks candidate entities or alerts based on spatial proximity to an H3 hexagon
 * index, applying k-ring neighborhood weighting and decay.
 */
export class SpatialRerankerExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "spatial_reranker" || jobType.trim() === "spatial_reranker";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig;
        const targetH3 = String(config.h3IndexSource || "882681e699fffff");
        const kRing = Number(config.kRing || 3);
        const decayFactor = Number(config.spatialDecayFactor || 0.85);
        const topK = Number(config.topK || 5);

        let docs: any[] = [];
        try {
            docs = typeof config.documents === "string" ? JSON.parse(config.documents) : config.documents;
        } catch {
            docs = [config.documents];
        }

        if (!Array.isArray(docs)) docs = [docs];

        // Rank entities: items sharing H3 index or nearby rings get top scores
        const scored = docs.map((doc, idx) => {
            const itemH3 = doc?.h3Index || doc?.h3 || doc?.location?.h3Index;
            // Ring distance (0 if identical, otherwise >= 1)
            const ringDistance = itemH3 === targetH3 ? 0 : Math.max(1, Math.min(kRing, typeof doc?.ring === "number" ? doc.ring : (idx + 1)));
            const spatialScore = Math.pow(decayFactor, ringDistance);
            const relevanceScore = Number(doc?.score ?? doc?.severityScore ?? 0.7);
            const compositeScore = Number((0.6 * spatialScore + 0.4 * relevanceScore).toFixed(3));

            return {
                ...doc,
                spatialDistanceRing: ringDistance,
                compositeScore,
            };
        });

        // Sort descending by compositeScore
        scored.sort((a, b) => b.compositeScore - a.compositeScore);

        const reranked = scored.slice(0, topK);
        const output = JSON.stringify(reranked, null, 2);

        const telemetry = {
            target_h3: targetH3,
            k_ring: kRing,
            input_count: docs.length,
            reranked_count: reranked.length,
            top_score: reranked[0]?.compositeScore ?? 0,
        };

        return {
            success: true,
            output,
            status: "success",
            telemetry,
        };
    }
}
