import { db } from "@server/database_service.js";
import { operationalCycles, missionRuns, aiUsageLogs } from "@shared/schema/index.js";
import { eq, and, sql, sum, avg, count, gte, lte, between, inArray, isNull, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("CycleAnalytics");

export interface CycleMetrics {
    cycleId: number;
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    successRate: number;
    totalSpend: number;
    totalTokens: number;
    averageExecutionTime: number;
    alignmentScore: number;
    riskScore: number;
    efficiency: number;
    roi: number;
}

export interface ProgramAnalytics {
    activeCycles: number;
    totalCycles: number;
    totalSpend: number;
    totalTokens: number;
    overallSuccessRate: number;
    averageAlignment: number;
    highRiskCycles: number;
    costEfficiency: number;
}

export interface HistoricalTrend {
    date: string;
    cycleCount: number;
    successRate: number;
    totalSpend: number;
    averageTokens: number;
    averageExecutionTime: number;
}

export interface PredictiveMetrics {
    cycleId: number;
    successProbability: number;
    riskFactors: string[];
    estimatedCompletionTime: number;
    estimatedCost: number;
    confidenceInterval: [number, number];
    recommendations: string[];
}

export class CycleAnalyticsService {
    /**
     * Calculate comprehensive metrics for a specific cycle
     */
    static async calculateCycleMetrics(cycleId: number, organizationId?: number): Promise<CycleMetrics> {
        logger.info(`[Analytics] Calculating metrics for cycle ${cycleId}`);

        const cycleConditions = [eq(operationalCycles.id, cycleId), isNull(operationalCycles.deletedAt)];
        if (typeof organizationId === "number") {
            cycleConditions.push(eq(operationalCycles.organizationId, organizationId));
        }
        const [cycle] = await db.select().from(operationalCycles).where(and(...cycleConditions)).limit(1);
        if (!cycle) throw new Error("Cycle not found");
        
        // Basic run statistics — ordered so slice(-10) gives the most recent
        const runs = await db.select().from(missionRuns)
            .where(and(eq(missionRuns.cycleId, cycleId), isNull(missionRuns.deletedAt)))
            .orderBy(desc(missionRuns.createdAt));
        const totalRuns = runs.length;
        const completedRuns = runs.filter(r => r.status === 'completed').length;
        const failedRuns = runs.filter(r => r.status === 'failed').length;
        
        // Cost and token aggregation
        const costResult = await db.select({ 
            totalCost: sum(aiUsageLogs.costUsd),
            totalTokens: sum(aiUsageLogs.totalTokens)
        })
            .from(aiUsageLogs)
            .innerJoin(missionRuns, eq(aiUsageLogs.executionId, missionRuns.pipelineExecutionId))
            .where(and(eq(missionRuns.cycleId, cycleId), isNull(missionRuns.deletedAt)));
        
        const totalSpend = costResult[0]?.totalCost ? parseFloat(String(costResult[0].totalCost)) : 0;
        const totalTokens = costResult[0]?.totalTokens ? parseInt(String(costResult[0].totalTokens)) : 0;
        
        // Execution time: updatedAt minus createdAt for completed/failed runs
        const executionTimes = runs
            .filter(r => r.status === 'completed' || r.status === 'failed')
            .map(r => new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime());
        const averageExecutionTime = executionTimes.length > 0
            ? executionTimes.reduce((a, b) => a + b) / executionTimes.length
            : 0;
        
        const alignmentScore = (cycle?.metadata as any)?.alignmentScore ?? 100;
        
        // Risk assessment based on recent failures and spend rate
        const recentRuns = runs.slice(0, 10); // Last 10 runs
        const recentFailures = recentRuns.filter(r => r.status === 'failed').length;
        const riskScore = Math.min(100, (recentFailures / (recentRuns.length || 1)) * 100 + (totalSpend > 100 ? 20 : 0));
        
        // Efficiency calculation (tokens per successful run)
        const efficiency = completedRuns > 0 ? totalTokens / completedRuns : 0;
        
        // ROI: completed runs per $100 spent
        const roi = totalSpend > 0 ? Math.round((completedRuns / totalSpend) * 100 * 100) / 100 : 0;
        
        return {
            cycleId,
            totalRuns,
            completedRuns,
            failedRuns,
            successRate: totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0,
            totalSpend,
            totalTokens,
            averageExecutionTime,
            alignmentScore,
            riskScore,
            efficiency,
            roi
        };
    }
    
    /**
     * Aggregate analytics across all cycles using 3 DB queries instead of N+1.
     */
    static async getProgramAnalytics(organizationId?: number): Promise<ProgramAnalytics> {
        logger.info(`[Analytics] Calculating program-wide analytics`);

        const cycleConditions = [isNull(operationalCycles.deletedAt)];
        if (typeof organizationId === "number") {
            cycleConditions.push(eq(operationalCycles.organizationId, organizationId));
        }

        // Query 1: cycle counts + average alignment from JSONB metadata
        const [cycleAgg] = await db.select({
            totalCycles: sql<number>`count(*)::int`,
            activeCycles: sql<number>`count(*) filter (where ${operationalCycles.status} = 'active')::int`,
            avgAlignment: sql<number>`coalesce(avg((${operationalCycles.metadata}->>'alignmentScore')::int) filter (where ${operationalCycles.metadata}->>'alignmentScore' is not null), 100)`,
        }).from(operationalCycles).where(and(...cycleConditions));

        // Query 2: per-cycle run stats in one pass (for success rate + high-risk detection)
        const cycleRunStats = await db.select({
            cycleId: missionRuns.cycleId,
            totalRuns: sql<number>`count(*)::int`,
            completedRuns: sql<number>`count(*) filter (where ${missionRuns.status} = 'completed')::int`,
            recentFailed: sql<number>`count(*) filter (where ${missionRuns.status} = 'failed' and ${missionRuns.createdAt} >= now() - interval '7 days')::int`,
            recentTotal: sql<number>`count(*) filter (where ${missionRuns.createdAt} >= now() - interval '7 days')::int`,
        })
        .from(missionRuns)
        .innerJoin(operationalCycles, eq(missionRuns.cycleId, operationalCycles.id))
        .where(and(...cycleConditions))
        .groupBy(missionRuns.cycleId);

        // Query 3: total cost + tokens across all cycle-linked runs
        const [costAgg] = await db.select({
            totalSpend: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}::numeric), 0)`,
            totalTokens: sql<string>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
        })
        .from(aiUsageLogs)
        .innerJoin(missionRuns, eq(aiUsageLogs.executionId, missionRuns.pipelineExecutionId))
        .innerJoin(operationalCycles, eq(missionRuns.cycleId, operationalCycles.id))
        .where(and(...cycleConditions));

        let totalRunsCount = 0, completedRunsCount = 0, highRiskCount = 0;
        for (const s of cycleRunStats) {
            totalRunsCount += s.totalRuns;
            completedRunsCount += s.completedRuns;
            const recentFailureRate = s.recentTotal > 0 ? s.recentFailed / s.recentTotal : 0;
            if (recentFailureRate > 0.7) highRiskCount++;
        }

        const totalSpend = parseFloat(String(costAgg?.totalSpend ?? 0));
        const totalTokens = parseInt(String(costAgg?.totalTokens ?? 0));

        return {
            activeCycles: cycleAgg?.activeCycles ?? 0,
            totalCycles: cycleAgg?.totalCycles ?? 0,
            totalSpend,
            totalTokens,
            overallSuccessRate: totalRunsCount > 0 ? Math.round((completedRunsCount / totalRunsCount) * 100) : 0,
            averageAlignment: Math.round(cycleAgg?.avgAlignment ?? 100),
            highRiskCycles: highRiskCount,
            costEfficiency: totalTokens > 0 ? totalRunsCount / totalTokens : 0,
        };
    }
    
    /**
     * Generate historical trend data for analytics.
     * Uses 2 GROUP BY queries instead of a per-day loop.
     */
    static async getHistoricalTrends(days: number = 30, organizationId?: number): Promise<HistoricalTrend[]> {
        logger.info(`[Analytics] Generating ${days} day historical trends`);

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const trendConditions = [
            gte(missionRuns.createdAt, startDate),
            isNull(missionRuns.deletedAt),
            isNull(operationalCycles.deletedAt),
        ];
        if (typeof organizationId === "number") {
            trendConditions.push(eq(operationalCycles.organizationId, organizationId));
        }

        // Query 1: run stats grouped by day
        const runRows = await db.select({
            date: sql<string>`to_char(date_trunc('day', ${missionRuns.createdAt}), 'YYYY-MM-DD')`,
            runCount: sql<number>`count(*)::int`,
            completedCount: sql<number>`count(*) filter (where ${missionRuns.status} = 'completed')::int`,
            cycleCount: sql<number>`count(distinct ${missionRuns.cycleId})::int`,
            avgMs: sql<number>`coalesce(avg(extract(epoch from (${missionRuns.updatedAt} - ${missionRuns.createdAt})) * 1000) filter (where ${missionRuns.status} in ('completed', 'failed')), 0)`,
        })
        .from(missionRuns)
        .innerJoin(operationalCycles, eq(missionRuns.cycleId, operationalCycles.id))
        .where(and(...trendConditions))
        .groupBy(sql`date_trunc('day', ${missionRuns.createdAt})`)
        .orderBy(sql`date_trunc('day', ${missionRuns.createdAt})`);

        // Query 2: cost + token stats grouped by day
        const spendRows = await db.select({
            date: sql<string>`to_char(date_trunc('day', ${missionRuns.createdAt}), 'YYYY-MM-DD')`,
            totalCost: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}::numeric), 0)`,
            avgTokens: sql<number>`coalesce(avg(${aiUsageLogs.totalTokens}), 0)::int`,
        })
        .from(aiUsageLogs)
        .innerJoin(missionRuns, eq(aiUsageLogs.executionId, missionRuns.pipelineExecutionId))
        .innerJoin(operationalCycles, eq(missionRuns.cycleId, operationalCycles.id))
        .where(and(...trendConditions))
        .groupBy(sql`date_trunc('day', ${missionRuns.createdAt})`);

        const runByDate = new Map(runRows.map(r => [r.date, r]));
        const spendByDate = new Map(spendRows.map(r => [r.date, r]));

        const trends: HistoricalTrend[] = [];
        for (let d = 0; d < days; d++) {
            const current = new Date(startDate);
            current.setDate(startDate.getDate() + d);
            const dateKey = current.toISOString().split('T')[0];

            const run = runByDate.get(dateKey);
            const spend = spendByDate.get(dateKey);

            trends.push({
                date: dateKey,
                cycleCount: run?.cycleCount ?? 0,
                successRate: run?.runCount ? Math.round((run.completedCount / run.runCount) * 100) : 0,
                totalSpend: spend ? parseFloat(String(spend.totalCost)) : 0,
                averageTokens: spend?.avgTokens ?? 0,
                averageExecutionTime: run?.avgMs ?? 0,
            });
        }

        return trends;
    }
    
    /**
     * Generate predictive analytics for cycle success probability
     */
    static async generatePredictiveMetrics(cycleId: number, organizationId?: number): Promise<PredictiveMetrics> {
        logger.info(`[Analytics] Generating predictive metrics for cycle ${cycleId}`);
        
        const currentMetrics = await this.calculateCycleMetrics(cycleId, organizationId);
        const cycleConditions = [eq(operationalCycles.id, cycleId), isNull(operationalCycles.deletedAt)];
        if (typeof organizationId === "number") {
            cycleConditions.push(eq(operationalCycles.organizationId, organizationId));
        }
        const [cycle] = await db.select().from(operationalCycles).where(and(...cycleConditions)).limit(1);
        
        if (!cycle) throw new Error("Cycle not found");

        const historicalTrends = await this.getHistoricalTrends(30, organizationId);
        const recentTrends = historicalTrends.slice(-7); 
        
        const avgSuccessRate = recentTrends.length > 0 
            ? recentTrends.reduce((sum, t) => sum + t.successRate, 0) / recentTrends.length
            : 50;
        
        const riskFactors: string[] = [];
        if (currentMetrics.riskScore > 70) riskFactors.push("High failure rate in recent runs");
        if (currentMetrics.totalSpend > parseFloat(String(cycle.budgetLimitUsd)) * 0.8) riskFactors.push("Approaching budget limit");
        if (currentMetrics.alignmentScore < 60) riskFactors.push("Low strategic alignment");
        if (currentMetrics.efficiency > 500000) riskFactors.push("High token consumption per run");
        
        let successProbability = avgSuccessRate;
        
        if (currentMetrics.successRate > avgSuccessRate) {
            successProbability = Math.min(95, successProbability + 10);
        } else if (currentMetrics.successRate < avgSuccessRate) {
            successProbability = Math.max(5, successProbability - 15);
        }
        
        riskFactors.forEach(() => {
            successProbability = Math.max(5, successProbability - 10);
        });
        
        const remainingRuns = Math.max(0, currentMetrics.totalRuns - currentMetrics.completedRuns);
        const estimatedCompletionTime = currentMetrics.averageExecutionTime * remainingRuns;
        const estimatedCost = currentMetrics.totalSpend + (remainingRuns * (currentMetrics.totalSpend / Math.max(1, currentMetrics.totalRuns)));
        
        const recommendations: string[] = [];
        if (currentMetrics.riskScore > 70) recommendations.push("Consider pausing program to investigate failure patterns");
        if (currentMetrics.efficiency > 500000) recommendations.push("Review blueprint design for token efficiency");
        if (currentMetrics.alignmentScore < 60) recommendations.push("Re-evaluate strategic objectives");
        if (successProbability < 60) recommendations.push("Consider additional validation steps");
        
        return {
            cycleId,
            successProbability: Math.round(successProbability),
            riskFactors,
            estimatedCompletionTime,
            estimatedCost: Math.round(estimatedCost * 100) / 100,
            confidenceInterval: [
                Math.max(5, successProbability - 15),
                Math.min(95, successProbability + 15)
            ],
            recommendations
        };
    }
    
    /**
     * Generate cost optimization recommendations
     */
    static async generateCostOptimization(cycleId: number, organizationId?: number): Promise<{
        recommendations: string[];
        potentialSavings: number;
        currentEfficiency: number;
        optimizedEfficiency: number;
    }> {
        const metrics = await this.calculateCycleMetrics(cycleId, organizationId);
        const cycleConditions = [eq(operationalCycles.id, cycleId), isNull(operationalCycles.deletedAt)];
        if (typeof organizationId === "number") {
            cycleConditions.push(eq(operationalCycles.organizationId, organizationId));
        }
        const [cycle] = await db.select().from(operationalCycles).where(and(...cycleConditions)).limit(1);
        
        if (!cycle) throw new Error("Cycle not found");

        const recommendations: string[] = [];
        let potentialSavings = 0;
        
        if (metrics.efficiency > 500000) {
            recommendations.push("Optimize AI prompts to reduce token consumption");
            potentialSavings += (metrics.efficiency - 300000) * (metrics.totalRuns / metrics.efficiency);
        }
        
        const budgetLimit = parseFloat(String(cycle.budgetLimitUsd));
        if (metrics.totalSpend > budgetLimit * 0.9) {
            recommendations.push("Consider adjusting budget limits or implementing spend controls");
            potentialSavings += (metrics.totalSpend - budgetLimit * 0.9);
        }
        
        if ((cycle.priority ?? 5) > 7 && metrics.successRate < 70) {
            recommendations.push("Consider increasing priority for better resource allocation");
        }
        
        const optimizedEfficiency = metrics.efficiency * (1 - (potentialSavings / Math.max(1, metrics.totalSpend)));
        
        return {
            recommendations,
            potentialSavings: Math.round(potentialSavings * 100) / 100,
            currentEfficiency: metrics.efficiency,
            optimizedEfficiency
        };
    }
    
    /**
     * Emit analytics event for real-time updates
     */
    static emitAnalyticsEvent(eventType: string, cycleId: number, data: any) {
        eventStream.publish(eventType, { cycleId, ...data }, {
            subject: `cycle:${cycleId}`,
        }, 'cycle-analytics').catch(() => {});
    }
}
