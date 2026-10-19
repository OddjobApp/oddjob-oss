/**
 * Token Tracking Service
 * Tracks AI token usage and calculates costs
 */

import { db } from "@server/database_service.js";
import { aiTokenUsage, aiTokenDailyAggregation } from "@shared/schema/index.js";
import { eq, and, gte, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { MODEL_PRICING } from "@server/domain/ai/core/cost-registry.js";

const logger = createLogger("TokenTrackingService");

// Delegate all pricing to the canonical cost registry (server/domain/ai/core/cost-registry.ts)
function getPricing(modelName: string): { input: number; output: number } {
    // cost-registry uses per-1M; convert to per-1K
    const entry = MODEL_PRICING[modelName] ?? MODEL_PRICING["default"];
    return { input: entry.input1M / 1000, output: entry.output1M / 1000 };
}

// Derived per-1K pricing map for callers that need a flat lookup (e.g., tests)
export const TOKEN_PRICING: Record<string, { input: number; output: number }> =
    Object.fromEntries(
        Object.entries(MODEL_PRICING).map(([name, entry]) => [
            name,
            { input: entry.input1M / 1000, output: entry.output1M / 1000 },
        ])
    );

interface TokenUsageData {
    jobId: number;
    jobRunId?: number;
    organizationId?: number;
    modelProvider: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs?: number;
    promptType?: string;
    promptCategory?: string;
    metadata?: any;
    // Mission/step attribution for per-step budget tracking
    missionId?: number;
    missionRunId?: number;
    stepCode?: string;
    stepOrder?: number;
    pipelineExecutionId?: number;
}

export const tokenTrackingService = {
    /**
     * Record token usage for an AI request
     */
    async recordUsage(data: TokenUsageData): Promise<any> {
        const totalTokens = data.inputTokens + data.outputTokens;
        
        // Calculate cost
        const pricing = getPricing(data.modelName);
        const inputCost = (data.inputTokens / 1000) * pricing.input;
        const outputCost = (data.outputTokens / 1000) * pricing.output;
        const totalCost = inputCost + outputCost;
        
        // Enrich metadata with mission/step attribution
        const enrichedMetadata = {
            ...(data.metadata || {}),
            ...(data.missionId ? { missionId: data.missionId } : {}),
            ...(data.missionRunId ? { missionRunId: data.missionRunId } : {}),
            ...(data.stepCode ? { stepCode: data.stepCode } : {}),
            ...(data.stepOrder !== undefined ? { stepOrder: data.stepOrder } : {}),
            ...(data.pipelineExecutionId ? { pipelineExecutionId: data.pipelineExecutionId } : {}),
        };
        
        try {
            const [record] = await db.insert(aiTokenUsage).values({
                jobId: data.jobId,
                jobRunId: data.jobRunId,
                organizationId: data.organizationId,
                modelProvider: data.modelProvider,
                modelName: data.modelName,
                inputTokens: data.inputTokens,
                outputTokens: data.outputTokens,
                totalTokens,
                inputCost: Math.round(inputCost * 100) / 100, // Round to 2 decimals
                outputCost: Math.round(outputCost * 100) / 100,
                totalCost: Math.round(totalCost * 100) / 100,
                latencyMs: data.latencyMs,
                promptType: data.promptType,
                promptCategory: data.promptCategory,
                metadata: enrichedMetadata,
            }).returning();
            
            logger.debug(`Recorded token usage: ${totalTokens} tokens ($${totalCost.toFixed(4)}) for job ${data.jobId}${data.stepCode ? ` step ${data.stepCode}` : ''}`);
            
            // Update daily aggregation
            await this.updateDailyAggregation(data.organizationId, data.modelName, totalTokens, totalCost);
            
            return record;
        } catch (err: any) {
            logger.error(`Failed to record token usage: ${err.message}`);
            throw err;
        }
    },
    
    /**
     * Update daily aggregation
     */
    async updateDailyAggregation(
        organizationId: number | undefined,
        modelName: string,
        tokens: number,
        cost: number
    ): Promise<void> {
        if (!organizationId) return;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Check if record exists for today
        const [existing] = await db
            .select()
            .from(aiTokenDailyAggregation)
            .where(and(
                eq(aiTokenDailyAggregation.organizationId, organizationId),
                eq(aiTokenDailyAggregation.date, today)
            ))
            .limit(1);
        
        if (existing) {
            // Update existing
            const modelBreakdown = (existing.modelBreakdown as any) || {};
            if (!modelBreakdown[modelName]) {
                modelBreakdown[modelName] = { tokens: 0, cost: 0 };
            }
            modelBreakdown[modelName].tokens += tokens;
            modelBreakdown[modelName].cost += cost;
            
            await db.update(aiTokenDailyAggregation)
                .set({
                    totalRequests: existing.totalRequests + 1,
                    totalInputTokens: existing.totalInputTokens + tokens, // Simplified - assuming all are input
                    totalOutputTokens: existing.totalOutputTokens, // Would need to track separately
                    totalCost: existing.totalCost + cost,
                    modelBreakdown,
                })
                .where(eq(aiTokenDailyAggregation.id, existing.id));
        } else {
            // Create new
            const modelBreakdown: any = {};
            modelBreakdown[modelName] = { tokens, cost };
            
            await db.insert(aiTokenDailyAggregation).values({
                organizationId,
                date: today,
                totalRequests: 1,
                totalInputTokens: tokens,
                totalOutputTokens: 0,
                totalCost: cost,
                modelBreakdown,
            });
        }
    },
    
    /**
     * Get token usage for a job
     */
    async getJobTokenUsage(jobId: number, days: number = 30): Promise<any> {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        
        const usage = await db
            .select()
            .from(aiTokenUsage)
            .where(and(
                eq(aiTokenUsage.jobId, jobId),
                gte(aiTokenUsage.requestTimestamp, startDate)
            ))
            .orderBy(sql`${aiTokenUsage.requestTimestamp} DESC`);
        
        if (usage.length === 0) {
            return { totalRequests: 0, totalCost: 0 };
        }
        
        const totals = usage.reduce((acc, u) => ({
            tokens: acc.tokens + u.totalTokens,
            cost: acc.cost + u.totalCost,
        }), { tokens: 0, cost: 0 });
        
        // Group by model
        const byModel = usage.reduce((acc: any, u) => {
            if (!acc[u.modelName]) {
                acc[u.modelName] = { tokens: 0, cost: 0, requests: 0 };
            }
            acc[u.modelName].tokens += u.totalTokens;
            acc[u.modelName].cost += u.totalCost;
            acc[u.modelName].requests += 1;
            return acc;
        }, {});
        
        // Daily trend
        const byDay = usage.reduce((acc: any, u) => {
            const date = new Date(u.requestTimestamp).toISOString().split("T")[0];
            if (!acc[date]) {
                acc[date] = { tokens: 0, cost: 0, requests: 0 };
            }
            acc[date].tokens += u.totalTokens;
            acc[date].cost += u.totalCost;
            acc[date].requests += 1;
            return acc;
        }, {});
        
        return {
            totalRequests: usage.length,
            totalTokens: totals.tokens,
            totalCost: Math.round(totals.cost * 100) / 100,
            avgCostPerRequest: Math.round((totals.cost / usage.length) * 100) / 100,
            avgLatency: Math.round(usage.reduce((acc, u) => acc + (u.latencyMs || 0), 0) / usage.length),
            byModel,
            byDay: Object.entries(byDay).map(([date, stats]: [string, any]) => ({
                date,
                ...stats,
            })),
            recentUsage: usage.slice(0, 10).map(u => ({
                timestamp: u.requestTimestamp,
                model: u.modelName,
                tokens: u.totalTokens,
                cost: u.totalCost,
                latency: u.latencyMs,
            })),
        };
    },
    
    /**
     * Get organization-wide token usage
     */
    async getOrgTokenUsage(organizationId: number, days: number = 30): Promise<any> {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        
        // Get daily aggregations
        const aggregations = await db
            .select()
            .from(aiTokenDailyAggregation)
            .where(and(
                eq(aiTokenDailyAggregation.organizationId, organizationId),
                gte(aiTokenDailyAggregation.date, startDate)
            ))
            .orderBy(aiTokenDailyAggregation.date);
        
        const totals = aggregations.reduce((acc, a) => ({
            requests: acc.requests + a.totalRequests,
            tokens: acc.tokens + a.totalInputTokens + a.totalOutputTokens,
            cost: acc.cost + a.totalCost,
        }), { requests: 0, tokens: 0, cost: 0 });
        
        // Top models
        const modelTotals: Record<string, { tokens: number; cost: number; requests: number }> = {};
        for (const agg of aggregations) {
            const breakdown = (agg.modelBreakdown as any) || {};
            for (const [model, stats] of Object.entries(breakdown)) {
                if (!modelTotals[model]) {
                    modelTotals[model] = { tokens: 0, cost: 0, requests: 0 };
                }
                modelTotals[model].tokens += (stats as any).tokens;
                modelTotals[model].cost += (stats as any).cost;
                modelTotals[model].requests += 1;
            }
        }
        
        return {
            periodDays: days,
            totalRequests: totals.requests,
            totalTokens: totals.tokens,
            totalCost: Math.round(totals.cost * 100) / 100,
            dailyTrend: aggregations.map(a => ({
                date: a.date.toISOString().split("T")[0],
                requests: a.totalRequests,
                tokens: a.totalInputTokens + a.totalOutputTokens,
                cost: Math.round(a.totalCost * 100) / 100,
            })),
            topModels: Object.entries(modelTotals)
                .map(([model, stats]) => ({ model, ...stats }))
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 5),
        };
    },
    
    /**
     * Get cost estimate for a potential request
     */
    getCostEstimate(modelName: string, inputTokens: number, outputTokens: number): {
        inputCost: number;
        outputCost: number;
        totalCost: number;
    } {
        const pricing = getPricing(modelName);
        const inputCost = (inputTokens / 1000) * pricing.input;
        const outputCost = (outputTokens / 1000) * pricing.output;
        
        return {
            inputCost: Math.round(inputCost * 10000) / 10000,
            outputCost: Math.round(outputCost * 10000) / 10000,
            totalCost: Math.round((inputCost + outputCost) * 10000) / 10000,
        };
    },
    
    /**
     * Get all supported models with pricing
     */
    getSupportedModels(): Array<{ name: string; inputPrice: number; outputPrice: number }> {
        return Object.entries(MODEL_PRICING).map(([name, entry]) => ({
            name,
            inputPrice: entry.input1M / 1000,
            outputPrice: entry.output1M / 1000,
        }));
    },

    /**
     * Get token usage for a specific mission step (for per-step budget enforcement)
     */
    async getMissionStepUsage(missionId: number, stepCode?: string): Promise<{ totalTokens: number; totalCost: number; byStep: Record<string, { tokens: number; cost: number }> }> {
        const usage = await db
            .select()
            .from(aiTokenUsage)
            .where(sql`${aiTokenUsage.metadata}->>'missionId' = ${String(missionId)}`);

        const byStep: Record<string, { tokens: number; cost: number }> = {};
        let totalTokens = 0;
        let totalCost = 0;

        for (const record of usage) {
            const meta = record.metadata as any;
            const code = meta?.stepCode || `step_${meta?.stepOrder || 'unknown'}`;
            
            if (!byStep[code]) byStep[code] = { tokens: 0, cost: 0 };
            byStep[code].tokens += record.totalTokens;
            byStep[code].cost += record.totalCost;
            totalTokens += record.totalTokens;
            totalCost += record.totalCost;
        }

        if (stepCode) {
            const stepData = byStep[stepCode] || { tokens: 0, cost: 0 };
            return { totalTokens: stepData.tokens, totalCost: stepData.cost, byStep: { [stepCode]: stepData } };
        }

        return { totalTokens, totalCost, byStep };
    },
};
