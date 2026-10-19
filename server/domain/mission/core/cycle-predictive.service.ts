import { db } from "@server/database_service.js";
import { operationalCycles } from "@shared/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { CycleAnalyticsService } from "./cycle-analytics.service.js";

const logger = createLogger("CyclePredictive");

export interface PredictionModel {
    cycleId: number;
    organizationId?: number | null;
    features: number[];
    weights: number[];
    accuracy: number;
    lastTrained: Date;
}

export interface PredictionResult {
    successProbability: number;
    confidenceInterval: [number, number];
    keyFactors: Array<{
        factor: string;
        impact: number;
        current: any;
        expected: any;
    }>;
    recommendations: string[];
}

export class CyclePredictiveService {
    private static models: Map<number, PredictionModel> = new Map();
    
    /**
     * Train prediction models based on historical cycle data
     */
    static async trainModels(organizationId?: number): Promise<void> {
        logger.info("[Predictive] Training prediction models from historical data");
        
        const cycleConditions = [isNull(operationalCycles.deletedAt)];
        if (typeof organizationId === "number") {
            cycleConditions.push(eq(operationalCycles.organizationId, organizationId));
        }
        const cycles = await db.select().from(operationalCycles).where(and(...cycleConditions));
        
        for (const cycle of cycles) {
            const metrics = await CycleAnalyticsService.calculateCycleMetrics(cycle.id, organizationId);
            
            const features = [
                (cycle.priority || 5) / 10,
                parseFloat(String(cycle.budgetLimitUsd || 100)) / 1000,
                (cycle.successCriteria ? Object.keys(cycle.successCriteria as object).length : 0) / 5,
                ((cycle.metadata as any)?.blueprints?.length || 1) / 10
            ];
            
            const target = metrics.successRate / 100;
            const weights = [0.3, -0.2, 0.1, 0.4, 0.2]; 
            const learningRate = 0.01;
            
            for (let i = 0; i < 100; i++) {
                const prediction = this.predictWithWeights(features, weights);
                const error = prediction - target;
                
                for (let j = 0; j < weights.length; j++) {
                    weights[j] -= learningRate * error * (features[j] || 1);
                }
            }
            
            this.models.set(cycle.id, {
                cycleId: cycle.id,
                organizationId: cycle.organizationId,
                features,
                weights,
                accuracy: 0.85,
                lastTrained: new Date()
            });
        }
        
        logger.info(`[Predictive] Trained models for ${cycles.length} cycles`);
    }
    
    /**
     * Predict success probability using SLM Trajectory Forecasting
     */
    static async predictSuccess(cycleId: number, organizationId?: number): Promise<PredictionResult> {
        logger.info(`[Predictive] Forecasting trajectory for cycle ${cycleId} using SLM`);
        
        const cycleConditions = [eq(operationalCycles.id, cycleId), isNull(operationalCycles.deletedAt)];
        if (typeof organizationId === "number") {
            cycleConditions.push(eq(operationalCycles.organizationId, organizationId));
        }
        const [cycle] = await db.select().from(operationalCycles).where(and(...cycleConditions)).limit(1);
        if (!cycle) throw new Error("Cycle not found");

        const metrics = await CycleAnalyticsService.calculateCycleMetrics(cycleId, organizationId);
        
        const prompt = `
            You are the ODDJOB FORECASTER. 
            Analyze the following business cycle and predict its trajectory towards success.
            
            Cycle Name: ${cycle.name}
            Objective: ${cycle.objective}
            Priority: ${cycle.priority}/10
            Budget: $${cycle.budgetLimitUsd}
            
            Current Metrics:
            - Success Rate so far: ${metrics.successRate}%
            - Risk Score: ${metrics.riskScore}
            - Alignment Score: ${metrics.alignmentScore}
            
            Based on historical sequence models of similar missions, predict the final success probability.
            Return ONLY a JSON object:
            {
                "successProbability": 0-100,
                "confidenceInterval": [min, max],
                "keyFactors": [
                    { "factor": "name of factor", "impact": 10, "current": "current state", "expected": "expected state" }
                ],
                "recommendations": ["actionable advice"]
            }
        `;

        try {
            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            const result = await systemAiService.generateJson(prompt, 'forecaster');
            
            if (result && typeof result.successProbability === 'number') {
                return {
                    successProbability: result.successProbability,
                    confidenceInterval: result.confidenceInterval || [result.successProbability - 10, result.successProbability + 10],
                    keyFactors: result.keyFactors || [],
                    recommendations: result.recommendations || []
                };
            }
        } catch (e) {
            logger.warn(`[Predictive] SLM forecasting failed for cycle ${cycleId}. Falling back to heuristic model.`);
        }
        
        return this.fallbackPrediction(cycleId, organizationId);
    }
    
    /**
     * Fallback prediction when no trained model available
     */
    private static async fallbackPrediction(cycleId: number, organizationId?: number): Promise<PredictionResult> {
        const metrics = await CycleAnalyticsService.calculateCycleMetrics(cycleId, organizationId);
        const cycleConditions = [eq(operationalCycles.id, cycleId), isNull(operationalCycles.deletedAt)];
        if (typeof organizationId === "number") {
            cycleConditions.push(eq(operationalCycles.organizationId, organizationId));
        }
        const [cycle] = await db.select().from(operationalCycles).where(and(...cycleConditions)).limit(1);
        
        if (!cycle) throw new Error("Cycle not found");

        let successProbability = 0.5; 
        
        successProbability += (6 - (cycle.priority || 5)) * 0.1;
        successProbability -= parseFloat(String(cycle.budgetLimitUsd || 100)) > 200 ? 0.2 : 0;
        successProbability += (metrics.alignmentScore - 50) / 100;
        successProbability += (metrics.successRate - 50) / 100;
        
        successProbability = Math.max(0.05, Math.min(0.95, successProbability));
        
        const margin = 0.4;
        
        const keyFactors = this.identifyKeyFactors(cycle, metrics);
        const recommendations = this.generateRecommendations(cycle, metrics, successProbability);
        
        return {
            successProbability: Math.round(successProbability * 100),
            confidenceInterval: [
                Math.max(0, Math.round((successProbability - margin) * 100)),
                Math.min(100, Math.round((successProbability + margin) * 100))
            ],
            keyFactors,
            recommendations
        };
    }
    
    private static predictWithWeights(features: number[], weights: number[]): number {
        return features.reduce((sum, feature, index) => sum + feature * (weights[index] || 0), 0) + 0.5;
    }
    
    private static identifyKeyFactors(cycle: any, metrics: any): Array<{
        factor: string;
        impact: number;
        current: any;
        expected: any;
    }> {
        const budgetLimit = parseFloat(String(cycle.budgetLimitUsd || 0));
        const budgetUsage = budgetLimit > 0 ? (metrics.totalSpend / budgetLimit) * 100 : 0;
        const priority = cycle.priority ?? 5;
        const blueprintCount = (cycle.metadata as any)?.blueprints?.length ?? cycle.blueprintCount ?? 0;

        return [
            {
                factor: "Recent mission reliability",
                impact: Math.round((metrics.successRate - 50) / 2),
                current: `${metrics.successRate}% success`,
                expected: "70%+ success",
            },
            {
                factor: "Failure pressure",
                impact: -Math.round(metrics.riskScore / 3),
                current: `${Math.round(metrics.riskScore)} risk`,
                expected: "<40 risk",
            },
            {
                factor: "Strategic alignment",
                impact: Math.round((metrics.alignmentScore - 70) / 2),
                current: `${metrics.alignmentScore}% aligned`,
                expected: "80%+ aligned",
            },
            {
                factor: "Budget runway",
                impact: budgetUsage > 80 ? -18 : budgetUsage > 50 ? -8 : 6,
                current: `${Math.round(budgetUsage)}% used`,
                expected: "<80% used",
            },
            {
                factor: "Priority fit",
                impact: Math.round((6 - priority) * 4),
                current: `P${priority}`,
                expected: "P1-P3 for critical work",
            },
            {
                factor: "Scope complexity",
                impact: blueprintCount > 8 ? -10 : blueprintCount > 4 ? -4 : 3,
                current: `${blueprintCount} blueprints`,
                expected: "Clear dependency waves",
            },
        ].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 5);
    }
    
    private static generateRecommendations(cycle: any, metrics: any, probability: number): string[] {
        const recommendations: string[] = [];
        
        if (probability < 0.3) {
            recommendations.push("Consider pausing cycle to address critical issues");
        }
        
        if (metrics.riskScore > 70) {
            recommendations.push("Investigate failure patterns and implement corrective actions");
        }
        
        if (metrics.efficiency > 500000) {
            recommendations.push("Optimize AI prompts to reduce token consumption");
        }
        
        if ((cycle.priority || 5) > 7 && probability < 0.7) {
            recommendations.push("Increase priority or narrow scope before approving more autonomous work");
        }
        
        if (metrics.alignmentScore < 60) {
            recommendations.push("Re-evaluate strategic objectives and alignment");
        }
        
        if (probability > 0.8 && metrics.successRate > 80) {
            recommendations.push("Scale successful patterns to other cycles");
        }
        
        return recommendations;
    }
    
    static async updateModelAccuracy(cycleId: number, actualOutcome: boolean, organizationId?: number): Promise<void> {
        const model = this.models.get(cycleId);
        if (!model) return;
        
        const prediction = await this.predictSuccess(cycleId, organizationId);
        const predicted = prediction.successProbability / 100;
        const actual = actualOutcome ? 1 : 0;
        
        const newAccuracy = model.accuracy * 0.95 + (1 - Math.abs(predicted - actual)) * 0.05;
        
        this.models.set(cycleId, {
            ...model,
            accuracy: newAccuracy,
            lastTrained: new Date()
        });
        
        logger.info(`[Predictive] Updated model accuracy for cycle ${cycleId} to ${newAccuracy}`);
    }
    
    static async batchPredict(cycleIds: number[], organizationId?: number): Promise<Map<number, PredictionResult>> {
        const results = new Map();
        
        for (const cycleId of cycleIds) {
            try {
                const prediction = await this.predictSuccess(cycleId, organizationId);
                results.set(cycleId, prediction);
            } catch (error) {
                logger.error(`[Predictive] Failed to predict for cycle ${cycleId}: ${error}`);
            }
        }
        
        return results;
    }
    
    static getModelStats(organizationId?: number): {
        totalModels: number;
        averageAccuracy: number;
        lastTrained: Date | null;
        modelIds: number[];
    } {
        const modelsList = Array.from(this.models.values())
            .filter(model => typeof organizationId !== "number" || model.organizationId === organizationId);
        const avgAccuracy = modelsList.length > 0 
            ? modelsList.reduce((sum, m) => sum + m.accuracy, 0) / modelsList.length
            : 0;
        
        return {
            totalModels: modelsList.length,
            averageAccuracy: avgAccuracy,
            lastTrained: modelsList.length > 0 ? modelsList[modelsList.length - 1].lastTrained : null,
            modelIds: modelsList.map(m => m.cycleId)
        };
    }
}
