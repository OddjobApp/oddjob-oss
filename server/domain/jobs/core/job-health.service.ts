/**
 * Job Health Score Service
 * Calculates composite health metrics for jobs
 */

import { db } from "@server/database_service.js";
import { jobs, jobRequestHistory } from "@shared/schema/index.js";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("JobHealthService");

interface HealthScoreComponents {
    successRate: number; // 0-100
    avgResponseTimeScore: number; // 0-100
    errorRateTrend: number; // 0-100 (higher is better)
    recencyScore: number; // 0-100
    overall: number; // Weighted composite
    errorCategories?: Record<string, number>;
    performance?: {
        avgExecutionTimeMs: number;
        p50ExecutionTimeMs: number;
        p95ExecutionTimeMs: number;
        p99ExecutionTimeMs: number;
        memoryUsageMB?: number;
        dbQueryTimeMs?: number;
        externalApiTimeMs?: number;
    };
}

interface HealthTrend {
    direction: "improving" | "stable" | "declining";
    changePercent: number;
    periodDays: number;
}

export const jobHealthService = {
    /**
     * Calculate comprehensive health score for a job
     */
    async calculateHealthScore(jobId: number): Promise<HealthScoreComponents> {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        // Get recent execution history
        const recentRuns = await db
            .select()
            .from(jobRequestHistory)
            .where(and(
                eq(jobRequestHistory.jobId, jobId),
                gte(jobRequestHistory.createdAt, thirtyDaysAgo)
            ))
            .orderBy(desc(jobRequestHistory.createdAt));
        
        if (recentRuns.length === 0) {
            return {
                successRate: 0,
                avgResponseTimeScore: 0,
                errorRateTrend: 0,
                recencyScore: 0,
                overall: 0,
            };
        }
        
        // Success rate (last 30 days)
        const successfulRuns = recentRuns.filter(r => r.responseStatus && r.responseStatus >= 200 && r.responseStatus < 300).length;
        const successRate = Math.round((successfulRuns / recentRuns.length) * 100);
        
        // Response time score (faster is better)
        const avgResponseTime = recentRuns.reduce((acc, r) => acc + (r.responseTimeMs || 0), 0) / recentRuns.length;
        let responseTimeScore = 100;
        if (avgResponseTime > 5000) responseTimeScore = 60;
        else if (avgResponseTime > 2000) responseTimeScore = 80;
        else if (avgResponseTime > 1000) responseTimeScore = 90;
        
        // Error trend (comparing first half vs second half of period)
        const halfPoint = Math.floor(recentRuns.length / 2);
        const firstHalfErrors = recentRuns.slice(0, halfPoint).filter(r => !r.responseStatus || r.responseStatus >= 400).length;
        const secondHalfErrors = recentRuns.slice(halfPoint).filter(r => !r.responseStatus || r.responseStatus >= 400).length;
        const firstHalfErrorRate = firstHalfErrors / halfPoint;
        const secondHalfErrorRate = secondHalfErrors / (recentRuns.length - halfPoint);
        const errorTrend = Math.max(0, Math.min(100, 100 - ((secondHalfErrorRate - firstHalfErrorRate) * 100)));
        
        // Recency score (when was last successful run)
        const lastSuccessfulRun = recentRuns.find(r => r.responseStatus && r.responseStatus >= 200 && r.responseStatus < 300);
        let recencyScore = 0;
        if (lastSuccessfulRun) {
            const hoursSinceLastSuccess = (now.getTime() - new Date(lastSuccessfulRun.createdAt).getTime()) / (1000 * 60 * 60);
            if (hoursSinceLastSuccess < 24) recencyScore = 100;
            else if (hoursSinceLastSuccess < 72) recencyScore = 80;
            else if (hoursSinceLastSuccess < 168) recencyScore = 60;
            else recencyScore = 40;
        }
        
        // Calculate error categories from failed runs
        const { errorClassificationService } = await import("./error-classification.service.js");
        const errorCategories: Record<string, number> = {
            transient: 0,
            permanent: 0,
            rate_limit: 0,
            authentication: 0,
            authorization: 0,
            validation: 0,
            unknown: 0,
        };
        
        for (const run of recentRuns) {
            if (!run.responseStatus || run.responseStatus >= 400) {
                // Try to extract an error message from the responseBody if it exists
                let errorMessage = `HTTP ${run.responseStatus || 'Unknown'}`;
                if (run.responseBody && typeof run.responseBody === 'object') {
                    const body = run.responseBody as any;
                    errorMessage = body.message || body.error || errorMessage;
                } else if (typeof run.responseBody === 'string') {
                    errorMessage = run.responseBody;
                }
                
                const category = errorClassificationService.classify(new Error(errorMessage));
                errorCategories[category]++;
            }
        }
        
        // Weighted composite score
        let overall = Math.round(
            successRate * 0.4 +
            responseTimeScore * 0.2 +
            errorTrend * 0.2 +
            recencyScore * 0.2
        );
        
        // Adjust score based on error types (permanent errors penalize more)
        let penalty = 0;
        if (errorCategories.permanent > 0) penalty += 20;
        if (errorCategories.authentication > 0) penalty += 15;
        if (errorCategories.authorization > 0) penalty += 15;
        
        overall = Math.max(0, overall - penalty);
        
        const performanceMetrics = await this.getPerformanceMetrics(jobId, recentRuns);

        return {
            successRate,
            avgResponseTimeScore: responseTimeScore,
            errorRateTrend: errorTrend,
            recencyScore,
            overall,
            errorCategories,
            performance: performanceMetrics,
        };
    },
    
    async getPerformanceMetrics(jobId: number, recentRuns: any[]): Promise<any> {
        if (!recentRuns || recentRuns.length === 0) {
            return {
                avgExecutionTimeMs: 0,
                p50ExecutionTimeMs: 0,
                p95ExecutionTimeMs: 0,
                p99ExecutionTimeMs: 0,
                memoryUsageMB: 0,
                dbQueryTimeMs: 0,
                externalApiTimeMs: 0,
            };
        }
        
        const executionTimes = recentRuns.map(r => r.responseTimeMs || 0);
        executionTimes.sort((a, b) => a - b);
        
        return {
            avgExecutionTimeMs: executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length,
            p50ExecutionTimeMs: executionTimes[Math.floor(executionTimes.length * 0.5)] || 0,
            p95ExecutionTimeMs: executionTimes[Math.floor(executionTimes.length * 0.95)] || 0,
            p99ExecutionTimeMs: executionTimes[Math.floor(executionTimes.length * 0.99)] || 0,
            // These would ideally come from the profiling service which we'll build next
            memoryUsageMB: 0,
            dbQueryTimeMs: 0,
            externalApiTimeMs: 0,
        };
    },
    
    /**
     * Get health trend over time
     */
    async getHealthTrend(jobId: number, days: number = 14): Promise<HealthTrend> {
        const now = new Date();
        const midPoint = new Date(now.getTime() - (days / 2) * 24 * 60 * 60 * 1000);
        const startPoint = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        
        const [firstHalfScore, secondHalfScore] = await Promise.all([
            this.calculatePeriodScore(jobId, startPoint, midPoint),
            this.calculatePeriodScore(jobId, midPoint, now),
        ]);
        
        const changePercent = firstHalfScore > 0 
            ? ((secondHalfScore - firstHalfScore) / firstHalfScore) * 100 
            : 0;
        
        let direction: "improving" | "stable" | "declining" = "stable";
        if (changePercent > 10) direction = "improving";
        else if (changePercent < -10) direction = "declining";
        
        return {
            direction,
            changePercent: Math.round(changePercent),
            periodDays: days,
        };
    },
    
    /**
     * Calculate score for a specific time period
     */
    async calculatePeriodScore(jobId: number, start: Date, end: Date): Promise<number> {
        const runs = await db
            .select()
            .from(jobRequestHistory)
            .where(and(
                eq(jobRequestHistory.jobId, jobId),
                gte(jobRequestHistory.createdAt, start),
                sql`${jobRequestHistory.createdAt} <= ${end}`
            ));
        
        if (runs.length === 0) return 0;
        
        const successful = runs.filter(r => r.responseStatus && r.responseStatus >= 200 && r.responseStatus < 300).length;
        return Math.round((successful / runs.length) * 100);
    },
    
    /**
     * Get health status label and color
     */
    getHealthStatus(score: number): { label: string; color: string; icon: string } {
        if (score >= 90) return { label: "Excellent", color: "#22c55e", icon: "CheckCircle" };
        if (score >= 75) return { label: "Good", color: "#84cc16", icon: "CheckCircle" };
        if (score >= 60) return { label: "Fair", color: "#eab308", icon: "AlertTriangle" };
        if (score >= 40) return { label: "Poor", color: "#f97316", icon: "AlertTriangle" };
        return { label: "Critical", color: "#ef4444", icon: "XCircle" };
    },
    
    /**
     * Get organization-wide health summary
     */
    async getOrgHealthSummary(organizationId: number): Promise<{
        totalJobs: number;
        healthyJobs: number;
        atRiskJobs: number;
        criticalJobs: number;
        averageHealthScore: number;
    }> {
        const orgJobs = await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(eq(jobs.organizationId, organizationId));
        
        let totalScore = 0;
        let healthyCount = 0;
        let atRiskCount = 0;
        let criticalCount = 0;
        
        for (const job of orgJobs) {
            const health = await this.calculateHealthScore(job.id);
            totalScore += health.overall;
            
            if (health.overall >= 75) healthyCount++;
            else if (health.overall >= 40) atRiskCount++;
            else criticalCount++;
        }
        
        return {
            totalJobs: orgJobs.length,
            healthyJobs: healthyCount,
            atRiskJobs: atRiskCount,
            criticalJobs: criticalCount,
            averageHealthScore: orgJobs.length > 0 ? Math.round(totalScore / orgJobs.length) : 0,
        };
    },
};
