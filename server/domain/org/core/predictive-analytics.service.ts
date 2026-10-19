import { db } from "@server/database_service.js";
import { eq, and, sql, desc, avg, count } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { missions, missionRuns, jobs, operationalCycles, orgSettings, documentTemplates, scheduledJobs, schedules } from "@shared/schema/index.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";

const logger = createLogger("PredictiveAnalyticsService");

/**
 * Prediction result
 */
export interface PredictionResult {
    type: string;
    prediction: any;
    confidence: number;
    factors: string[];
    timestamp: Date;
}

/**
 * Feature delivery prediction
 */
export interface FeatureDeliveryPrediction {
    featureId: string;
    featureName: string;
    estimatedCompletionDate: Date;
    confidenceInterval: {
        optimistic: Date;
        pessimistic: Date;
    };
    probability: number;
    riskFactors: string[];
    recommendations: string[];
}

/**
 * Sprint completion prediction
 */
export interface SprintCompletionPrediction {
    sprintId: string;
    sprintName: string;
    completionProbability: number;
    estimatedVelocity: number;
    recommendedActions: string[];
    resourceConflicts: string[];
}

/**
 * Agent burnout prediction
 */
export interface AgentBurnoutPrediction {
    agentId: string;
    agentName: string;
    burnoutRisk: "low" | "medium" | "high" | "critical";
    contributingFactors: string[];
    recommendedActions: string[];
    timeline: string;
}

/**
 * Budget overrun prediction
 */
export interface BudgetOverrunPrediction {
    organizationId: number;
    currentSpend: number;
    projectedSpend: number;
    budgetLimit: number;
    overrunProbability: number;
    riskFactors: string[];
    mitigationStrategies: string[];
}

/**
 * Predictive Analytics Service
 * AI-powered predictions for SDLC optimization
 */
export class PredictiveAnalyticsService {
    private static instance: PredictiveAnalyticsService;
    private predictionCache: Map<string, { result: any; expiresAt: Date }> = new Map();
    private cacheTTLMinutes = 60;

    private constructor() {
        this.initializePredictiveModels();
    }

    static getInstance(): PredictiveAnalyticsService {
        if (!PredictiveAnalyticsService.instance) {
            PredictiveAnalyticsService.instance = new PredictiveAnalyticsService();
        }
        return PredictiveAnalyticsService.instance;
    }

    /**
     * Initialize predictive models
     */
    private initializePredictiveModels(): void {
        logger.info("[PredictiveAnalytics] Predictive models initialized");
    }

    /**
     * Predict feature delivery date
     */
    async predictFeatureDelivery(organizationId: number, featureId: string): Promise<FeatureDeliveryPrediction> {
        logger.info(`[PredictiveAnalytics] Predicting delivery for feature ${featureId}`);

        const cacheKey = `feature_delivery_${organizationId}_${featureId}`;
        const cached = this.getCachedPrediction(cacheKey);
        if (cached) {
            return cached.result as FeatureDeliveryPrediction;
        }

        // Gather historical data
        const historicalVelocity = await this.getHistoricalVelocity(organizationId);
        const similarFeatures = await this.getSimilarFeatures(organizationId, featureId);
        const currentBlockers = await this.getCurrentBlockers(organizationId);

        // Use AI to generate prediction
        const prompt = `Analyze the following data to predict feature delivery:
        - Historical velocity: ${JSON.stringify(historicalVelocity)}
        - Similar features: ${JSON.stringify(similarFeatures)}
        - Current blockers: ${JSON.stringify(currentBlockers)}
        
        Return a JSON object with:
        - estimatedCompletionDate (ISO date string)
        - confidenceInterval (optimistic and pessimistic dates)
        - probability (0-1)
        - riskFactors (array of strings)
        - recommendations (array of strings)`;

        const prediction = await systemAiService.generateJson(prompt, 'analyst' as any);

        const result: FeatureDeliveryPrediction = {
            featureId,
            featureName: featureId,
            estimatedCompletionDate: new Date(prediction.estimatedCompletionDate),
            confidenceInterval: {
                optimistic: new Date(prediction.confidenceInterval.optimistic),
                pessimistic: new Date(prediction.confidenceInterval.pessimistic),
            },
            probability: prediction.probability,
            riskFactors: prediction.riskFactors || [],
            recommendations: prediction.recommendations || [],
        };

        this.cachePrediction(cacheKey, result);
        return result;
    }

    /**
     * Predict sprint completion
     */
    async predictSprintCompletion(organizationId: number, sprintId: string): Promise<SprintCompletionPrediction> {
        logger.info(`[PredictiveAnalytics] Predicting sprint completion for ${sprintId}`);

        const cacheKey = `sprint_completion_${organizationId}_${sprintId}`;
        const cached = this.getCachedPrediction(cacheKey);
        if (cached) {
            return cached.result as SprintCompletionPrediction;
        }

        // Gather sprint data
        const sprintProgress = await this.getSprintProgress(organizationId, sprintId);
        const teamCapacity = await this.getTeamCapacity(organizationId);
        const historicalSprints = await this.getHistoricalSprints(organizationId);

        const prompt = `Analyze the following sprint data to predict completion:
        - Current progress: ${JSON.stringify(sprintProgress)}
        - Team capacity: ${JSON.stringify(teamCapacity)}
        - Historical sprints: ${JSON.stringify(historicalSprints)}
        
        Return a JSON object with:
        - completionProbability (0-1)
        - estimatedVelocity (number)
        - recommendedActions (array of strings)
        - resourceConflicts (array of strings)`;

        const prediction = await systemAiService.generateJson(prompt, 'analyst' as any);

        const result: SprintCompletionPrediction = {
            sprintId,
            sprintName: sprintId,
            completionProbability: prediction.completionProbability,
            estimatedVelocity: prediction.estimatedVelocity,
            recommendedActions: prediction.recommendedActions || [],
            resourceConflicts: prediction.resourceConflicts || [],
        };

        this.cachePrediction(cacheKey, result);
        return result;
    }

    /**
     * Predict agent burnout
     */
    async predictAgentBurnout(organizationId: number, agentId: string): Promise<AgentBurnoutPrediction> {
        logger.info(`[PredictiveAnalytics] Predicting burnout for agent ${agentId}`);

        const cacheKey = `agent_burnout_${organizationId}_${agentId}`;
        const cached = this.getCachedPrediction(cacheKey);
        if (cached) {
            return cached.result as AgentBurnoutPrediction;
        }

        // Gather agent performance data
        const agentPerformance = await this.getAgentPerformance(organizationId, agentId);
        const tokenUsage = await this.getAgentTokenUsage(organizationId, agentId);
        const errorRates = await this.getAgentErrorRates(organizationId, agentId);

        const prompt = `Analyze the following agent data to predict burnout risk:
        - Performance metrics: ${JSON.stringify(agentPerformance)}
        - Token usage: ${JSON.stringify(tokenUsage)}
        - Error rates: ${JSON.stringify(errorRates)}
        
        Return a JSON object with:
        - burnoutRisk (one of: low, medium, high, critical)
        - contributingFactors (array of strings)
        - recommendedActions (array of strings)
        - timeline (string describing expected timeline)`;

        const prediction = await systemAiService.generateJson(prompt, 'analyst' as any);

        const result: AgentBurnoutPrediction = {
            agentId,
            agentName: agentId,
            burnoutRisk: prediction.burnoutRisk,
            contributingFactors: prediction.contributingFactors || [],
            recommendedActions: prediction.recommendedActions || [],
            timeline: prediction.timeline || "Unknown",
        };

        this.cachePrediction(cacheKey, result);
        return result;
    }

    /**
     * Predict budget overrun
     */
    async predictBudgetOverrun(organizationId: number): Promise<BudgetOverrunPrediction> {
        logger.info(`[PredictiveAnalytics] Predicting budget overrun for org ${organizationId}`);

        const cacheKey = `budget_overrun_${organizationId}`;
        const cached = this.getCachedPrediction(cacheKey);
        if (cached) {
            return cached.result as BudgetOverrunPrediction;
        }

        // Gather budget data
        const [settings] = await db.select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, organizationId))
            .limit(1);

        const currentSpend = Number(settings?.currentMonthSpendUsd || 0);
        const budgetLimit = Number(settings?.monthlyBudgetUsd || 100);

        const spendingTrend = await this.getSpendingTrend(organizationId);
        const upcomingWork = await this.getUpcomingWork(organizationId);

        const prompt = `Analyze the following budget data to predict overrun:
        - Current spend: ${currentSpend}
        - Budget limit: ${budgetLimit}
        - Spending trend: ${JSON.stringify(spendingTrend)}
        - Upcoming work: ${JSON.stringify(upcomingWork)}
        
        Return a JSON object with:
        - projectedSpend (number)
        - overrunProbability (0-1)
        - riskFactors (array of strings)
        - mitigationStrategies (array of strings)`;

        const prediction = await systemAiService.generateJson(prompt, 'analyst' as any);

        const result: BudgetOverrunPrediction = {
            organizationId,
            currentSpend,
            projectedSpend: prediction.projectedSpend,
            budgetLimit,
            overrunProbability: prediction.overrunProbability,
            riskFactors: prediction.riskFactors || [],
            mitigationStrategies: prediction.mitigationStrategies || [],
        };

        this.cachePrediction(cacheKey, result);
        return result;
    }

    /**
     * Get historical velocity
     */
    private async getHistoricalVelocity(organizationId: number): Promise<any[]> {
        const results = await db.select({
            week: sql<string>`DATE_TRUNC('week', ${missionRuns.createdAt})`,
            avgCost: avg(missionRuns.costUsd),
            totalRuns: count(),
            avgDuration: avg(sql<number>`EXTRACT(EPOCH FROM (${missionRuns.updatedAt} - ${missionRuns.createdAt}))`),
        })
        .from(missionRuns)
        .innerJoin(missions, eq(missionRuns.missionId, missions.id))
        .where(eq(missions.organizationId, organizationId))
        .groupBy(sql`DATE_TRUNC('week', ${missionRuns.createdAt})`)
        .orderBy(sql`DATE_TRUNC('week', ${missionRuns.createdAt})`)
        .limit(12);

        return results.map(r => ({
            week: r.week,
            avgCost: Number(r.avgCost || 0),
            totalRuns: Number(r.totalRuns || 0),
            avgDuration: Number(r.avgDuration || 0),
        }));
    }

    /**
     * Get similar features
     */
    private async getSimilarFeatures(organizationId: number, featureId: string): Promise<any[]> {
        // Query document templates for similar requirements
        const templates = await db.select()
            .from(documentTemplates)
            .where(eq(documentTemplates.organizationId, organizationId))
            .limit(10);

        return templates.map(t => ({
            id: t.name,
            name: t.name,
            content: t.content,
            similarity: 0.5, // Placeholder for similarity calculation
        }));
    }

    /**
     * Get current blockers
     */
    private async getCurrentBlockers(organizationId: number): Promise<any[]> {
        // Query mission runs that failed or are stuck
        const blockedRuns = await db.select()
            .from(missionRuns)
            .innerJoin(missions, eq(missionRuns.missionId, missions.id))
            .where(and(
                eq(missions.organizationId, organizationId),
                sql`${missionRuns.isSuccess} = false OR ${missionRuns.status} = 'running'`
            ))
            .limit(10);

        return blockedRuns.map(r => ({
            missionId: r.missions.id,
            missionName: r.missions.name,
            status: r.mission_runs.status,
            failureReason: r.mission_runs.failureReason,
        }));
    }

    /**
     * Get sprint progress
     */
    private async getSprintProgress(organizationId: number, sprintId: string): Promise<any> {
        // Query mission runs for the sprint
        const runs = await db.select()
            .from(missionRuns)
            .innerJoin(missions, eq(missionRuns.missionId, missions.id))
            .where(and(
                eq(missions.organizationId, organizationId),
                sql`${missions.name} LIKE ${`%${sprintId}%`}`
            ))
            .limit(100);

        const completed = runs.filter(r => r.mission_runs.isSuccess).length;
        const total = runs.length;
        const remaining = total - completed;

        return {
            completed,
            total,
            remaining,
            progress: total > 0 ? (completed / total) * 100 : 0,
        };
    }

    /**
     * Get team capacity
     */
    private async getTeamCapacity(organizationId: number): Promise<any> {
        // Query jobs to estimate team capacity
        const activeJobs = await db.select()
            .from(jobs)
            .where(eq(jobs.organizationId, organizationId))
            .limit(50);

        const activeAgents = activeJobs.filter(j => j.isActive).length;
        const totalAgents = activeJobs.length;

        return {
            available: activeAgents,
            allocated: totalAgents,
            utilization: totalAgents > 0 ? (activeAgents / totalAgents) * 100 : 0,
        };
    }

    /**
     * Get historical sprints
     */
    private async getHistoricalSprints(organizationId: number): Promise<any[]> {
        // Query historical mission runs grouped by week
        const results = await db.select({
            week: sql<string>`DATE_TRUNC('week', ${missionRuns.createdAt})`,
            totalMissions: count(),
            completedMissions: count(sql`CASE WHEN ${missionRuns.isSuccess} THEN 1 END`),
            avgDuration: avg(sql<number>`EXTRACT(EPOCH FROM (${missionRuns.updatedAt} - ${missionRuns.createdAt}))`),
        })
        .from(missionRuns)
        .innerJoin(missions, eq(missionRuns.missionId, missions.id))
        .where(eq(missions.organizationId, organizationId))
        .groupBy(sql`DATE_TRUNC('week', ${missionRuns.createdAt})`)
        .orderBy(sql`DATE_TRUNC('week', ${missionRuns.createdAt})`)
        .limit(12);

        return results.map(r => ({
            week: r.week,
            totalMissions: Number(r.totalMissions || 0),
            completedMissions: Number(r.completedMissions || 0),
            completionRate: r.totalMissions > 0 ? (Number(r.completedMissions || 0) / Number(r.totalMissions)) * 100 : 0,
            avgDuration: Number(r.avgDuration || 0),
        }));
    }

    /**
     * Get agent performance
     */
    private async getAgentPerformance(organizationId: number, agentId: string): Promise<any> {
        const [agent] = await db.select()
            .from(jobs)
            .where(and(
                eq(jobs.organizationId, organizationId),
                eq(jobs.name, agentId)
            ))
            .limit(1);

        if (!agent) return {};

        // Get mission runs for this agent
        const runs = await db.select()
            .from(missionRuns)
            .where(eq((missionRuns as any).agentJobId, agent.id))
            .limit(100);

        const successRate = runs.length > 0 
            ? (runs.filter(r => r.isSuccess).length / runs.length) * 100 
            : 0;

        return {
            ...agent,
            successRate,
            totalRuns: runs.length,
            isActive: agent.isActive,
        };
    }

    /**
     * Get agent token usage
     */
    private async getAgentTokenUsage(organizationId: number, agentId: string): Promise<any> {
        const [agent] = await db.select()
            .from(jobs)
            .where(and(
                eq(jobs.organizationId, organizationId),
                eq(jobs.name, agentId)
            ))
            .limit(1);

        if (!agent) return { total: 0, average: 0, trend: [] };

        // Get token usage from mission runs
        const runs = await db.select({
            tokens: (missionRuns as any).tokensUsed,
            createdAt: missionRuns.createdAt,
        })
        .from(missionRuns)
        .where(eq((missionRuns as any).agentJobId, agent.id))
        .orderBy(sql`${missionRuns.createdAt} DESC`)
        .limit(30);

        const total = runs.reduce((sum, r) => sum + (Number(r.tokens) || 0), 0);
        const average = runs.length > 0 ? total / runs.length : 0;
        const trend = runs.map(r => ({
            date: r.createdAt,
            tokens: Number(r.tokens || 0),
        }));

        return { total, average, trend };
    }

    /**
     * Get agent error rates
     */
    private async getAgentErrorRates(organizationId: number, agentId: string): Promise<any> {
        const [agent] = await db.select()
            .from(jobs)
            .where(and(
                eq(jobs.organizationId, organizationId),
                eq(jobs.name, agentId)
            ))
            .limit(1);

        if (!agent) return { errorRate: 0, trend: [] };

        const runs = await db.select()
            .from(missionRuns)
            .where(eq((missionRuns as any).agentJobId, agent.id))
            .orderBy(sql`${missionRuns.createdAt} DESC`)
            .limit(30);

        const errorRate = runs.length > 0 
            ? (runs.filter(r => !r.isSuccess).length / runs.length) * 100 
            : 0;

        const trend = runs.map(r => ({
            date: r.createdAt,
            success: r.isSuccess,
        }));

        return { errorRate, trend };
    }

    /**
     * Get spending trend
     */
    private async getSpendingTrend(organizationId: number): Promise<any[]> {
        const results = await db.select({
            month: sql<string>`DATE_TRUNC('month', ${missionRuns.createdAt})`,
            totalCost: sql<number>`SUM(${missionRuns.costUsd})`,
            totalRuns: count(),
        })
        .from(missionRuns)
        .innerJoin(missions, eq(missionRuns.missionId, missions.id))
        .where(eq(missions.organizationId, organizationId))
        .groupBy(sql`DATE_TRUNC('month', ${missionRuns.createdAt})`)
        .orderBy(sql`DATE_TRUNC('month', ${missionRuns.createdAt})`)
        .limit(12);

        return results.map(r => ({
            month: r.month,
            totalCost: Number(r.totalCost || 0),
            totalRuns: Number(r.totalRuns || 0),
        }));
    }

    /**
     * Get upcoming work
     */
    private async getUpcomingWork(organizationId: number): Promise<any[]> {
        // Get scheduled jobs
        const scheduled = await db.select({
            job: scheduledJobs,
            schedule: schedules,
        })
        .from(scheduledJobs)
        .innerJoin(schedules, eq(scheduledJobs.scheduleId, schedules.id))
        .where(eq(schedules.organizationId, organizationId))
        .limit(20);

        return scheduled.map(s => ({
            jobId: s.job.id,
            jobName: s.job.name,
            scheduleId: s.schedule.id,
            nextRun: (s.schedule as any).nextRunAt || new Date(),
        }));
    }

    /**
     * Get cached prediction
     */
    private getCachedPrediction(key: string): { result: any; expiresAt: Date } | null {
        const cached = this.predictionCache.get(key);
        if (!cached) return null;

        if (new Date() > cached.expiresAt) {
            this.predictionCache.delete(key);
            return null;
        }

        return cached;
    }

    /**
     * Cache prediction
     */
    private cachePrediction(key: string, result: any): void {
        const expiresAt = new Date(Date.now() + this.cacheTTLMinutes * 60 * 1000);
        this.predictionCache.set(key, { result, expiresAt });
    }

    /**
     * Clear prediction cache
     */
    clearCache(): void {
        this.predictionCache.clear();
        logger.info("[PredictiveAnalytics] Prediction cache cleared");
    }

    /**
     * Generate comprehensive analytics report
     */
    async generateAnalyticsReport(organizationId: number): Promise<{
        featureDelivery: FeatureDeliveryPrediction[];
        sprintCompletion: SprintCompletionPrediction[];
        agentBurnout: AgentBurnoutPrediction[];
        budgetOverrun: BudgetOverrunPrediction;
        generatedAt: Date;
    }> {
        logger.info(`[PredictiveAnalytics] Generating analytics report for org ${organizationId}`);

        const [cycle] = await db.select()
            .from(operationalCycles)
            .where(eq(operationalCycles.organizationId, organizationId))
            .limit(1);

        const metadata = cycle?.metadata as any;
        const missions = metadata?.blueprints || [];

        // Generate predictions for all missions
        const featureDeliveryPredictions = await Promise.all(
            missions.map((m: any) => this.predictFeatureDelivery(organizationId, m.name))
        );

        const sprintCompletionPredictions = await Promise.all(
            missions.map((m: any) => this.predictSprintCompletion(organizationId, m.name))
        );

        const agentBurnoutPredictions = await Promise.all(
            metadata?.agents?.map((a: any) => this.predictAgentBurnout(organizationId, a.name)) || []
        );

        const budgetOverrunPrediction = await this.predictBudgetOverrun(organizationId);

        return {
            featureDelivery: featureDeliveryPredictions,
            sprintCompletion: sprintCompletionPredictions,
            agentBurnout: agentBurnoutPredictions,
            budgetOverrun: budgetOverrunPrediction,
            generatedAt: new Date(),
        };
    }
}

export const predictiveAnalyticsService = PredictiveAnalyticsService.getInstance();
