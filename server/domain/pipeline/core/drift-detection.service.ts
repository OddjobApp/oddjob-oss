import { db } from "@server/database_service.js";
import { driftScores, pipelines } from "@shared/schema/index.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { eq } from "drizzle-orm";
import { logger } from "@server/utils/logger.js";
import { evolutionService } from "@domain/evolution/core/evolution.service.js";

export class DriftDetectionService {
    /**
     * Compare a pipeline execution against its Gold Baseline
     */
    async analyzeExecution(pipelineId: number, executionId: number, currentOutput: any): Promise<number> {
        try {
            // 1. Fetch Pipeline and Baseline
            const [pipeline] = await db
                .select()
                .from(pipelines)
                .where(eq(pipelines.id, pipelineId))
                .limit(1);

            if (!pipeline || !pipeline.baselineOutput) {
                return 0; // No baseline to compare against
            }

            const baseline = pipeline.baselineOutput;
            
            // 2. Calculate Drift Score (0.0 to 1.0)
            const score = this.calculateDrift(currentOutput, baseline);
            
            // 3. Persist Score
            await db.insert(driftScores).values({
                organizationId: pipeline.organizationId,
                pipelineId,
                executionId,
                driftScore: score,
                driftType: 'semantic',
                metadata: {
                    baselineRunId: pipeline.baselineRunId,
                    timestamp: new Date().toISOString()
                }
            });

            // 4. Emit Event if drift is significant (> 0.2)
            if (score > 0.2) {
                eventStream.emit("job.drift_detected", {
                    eventType: "job.drift_detected",
                    pipelineId,
                    executionId,
                    organizationId: pipeline.organizationId,
                    payload: {
                        driftScore: score,
                        pipelineId,
                        executionId,
                        message: `Significant drift detected in Pipeline #${pipelineId}: ${(score * 100).toFixed(1)}% deviation.`
                    }
                });
                logger.warn(`[DriftDetection] Significant drift detected for pipeline ${pipelineId}: ${score}`);
                
                // --- AUTONOMOUS EVOLUTION ---
                if (pipeline.selfHealingEnabled && score > 0.3) {
                    await evolutionService.evolvePipeline(pipelineId, score);
                }
            }

            return score;
        } catch (error) {
            logger.error("[DriftDetection] Analysis failed:", error);
            return 0;
        }
    }

    /**
     * Simple Recursive Drift Calculation
     * Returns a score between 0 (identical) and 1 (completely different)
     */
    private calculateDrift(current: any, baseline: any): number {
        if (typeof current !== typeof baseline) return 1.0;
        
        if (typeof current === 'object' && current !== null && baseline !== null) {
            const currentKeys = Object.keys(current);
            const baselineKeys = Object.keys(baseline);
            const allKeys = Array.from(new Set([...currentKeys, ...baselineKeys]));
            
            if (allKeys.length === 0) return 0;
            
            let totalDrift = 0;
            for (const key of allKeys) {
                if (!(key in current) || !(key in baseline)) {
                    totalDrift += 1.0;
                } else {
                    totalDrift += this.calculateDrift(current[key], baseline[key]);
                }
            }
            return totalDrift / allKeys.length;
        }
        
        if (typeof current === 'string') {
            return this.calculateStringDrift(current, baseline);
        }
        
        return current === baseline ? 0 : 1.0;
    }

    private calculateStringDrift(s1: string, s2: string): number {
        if (s1 === s2) return 0;
        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;
        if (longer.length === 0) return 0;
        
        const editDistance = this.levenshtein(longer, shorter);
        return editDistance / longer.length;
    }

    private levenshtein(s1: string, s2: string): number {
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) {
                    costs[j] = j;
                } else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    }
}

export const driftDetectionService = new DriftDetectionService();
