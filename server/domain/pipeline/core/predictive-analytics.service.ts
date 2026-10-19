import { db } from "@server/database_service.js";
import { driftScores } from "@shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";
import { logger } from "@server/utils/logger.js";

export interface PredictionResult {
    currentSlope: number; // Deviation change per execution
    isIncreasing: boolean;
    runsUntilBreach: number | null; // Estimated executions until 20% drift
    predictedBreachDate: Date | null;
    confidence: number; // 0.0 to 1.0 based on R-squared or sample size
}

export class PredictiveAnalyticsService {
    /**
     * Predict drift trajectory for a pipeline
     */
    async predictPipelineDrift(pipelineId: number): Promise<PredictionResult> {
        try {
            // 1. Fetch last 15 scores
            const scores = await db
                .select()
                .from(driftScores)
                .where(eq(driftScores.pipelineId, pipelineId))
                .orderBy(desc(driftScores.createdAt))
                .limit(15);

            if (scores.length < 3) {
                return { 
                    currentSlope: 0, 
                    isIncreasing: false, 
                    runsUntilBreach: null, 
                    predictedBreachDate: null, 
                    confidence: 0 
                };
            }

            // Reverse to get chronological order [oldest -> newest]
            const data = scores.reverse().map((s, index) => ({
                x: index,
                y: s.driftScore
            }));

            // 2. Perform Linear Regression (y = mx + b)
            const n = data.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            for (const p of data) {
                sumX += p.x;
                sumY += p.y;
                sumXY += p.x * p.y;
                sumX2 += p.x * p.x;
            }

            const denominator = (n * sumX2 - sumX * sumX);
            if (denominator === 0) throw new Error("Division by zero in regression");
            
            const slope = (n * sumXY - sumX * sumY) / denominator;
            const intercept = (sumY - slope * sumX) / n;

            // 3. Calculate Prediction
            const threshold = 0.20; // 20% drift limit
            let runsUntilBreach = null;
            let predictedBreachDate = null;

            if (slope > 0) {
                const currentY = data[data.length - 1].y;
                if (currentY < threshold) {
                    runsUntilBreach = Math.ceil((threshold - currentY) / slope);
                    
                    // Estimate date based on average interval between last few runs
                    const firstDate = new Date(scores[0].createdAt).getTime();
                    const lastDate = new Date(scores[scores.length - 1].createdAt).getTime();
                    const avgInterval = (lastDate - firstDate) / (n - 1);
                    
                    predictedBreachDate = new Date(lastDate + (runsUntilBreach * avgInterval));
                }
            }

            return {
                currentSlope: slope,
                isIncreasing: slope > 0,
                runsUntilBreach,
                predictedBreachDate,
                confidence: Math.min(n / 15, 0.9) // Simple confidence based on sample size
            };
        } catch (error) {
            logger.error("[PredictiveAnalytics] Prediction failed:", error);
            return { currentSlope: 0, isIncreasing: false, runsUntilBreach: null, predictedBreachDate: null, confidence: 0 };
        }
    }
}

export const predictiveAnalyticsService = new PredictiveAnalyticsService();
