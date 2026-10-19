/**
 * Temporal Pattern Detection Service
 * 
 * Detects seasonal patterns in job/mission execution, identifies anomalies in execution timing,
 * predicts resource needs based on temporal patterns, and provides scheduling optimization.
 * 
 * Expected Impact: Better resource planning, anomaly detection, scheduling optimization
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { jobs, missions, pipelineExecutions } from "@shared/schema/index.js";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

const logger = createLogger("TemporalAnalytics");

export interface TemporalPattern {
  type: "hourly" | "daily" | "weekly" | "monthly";
  period: string;
  count: number;
  averageDuration: number;
  averageCost: number;
  successRate: number;
}

export interface Anomaly {
  type: "spike" | "drop" | "outlier";
  entityType: "job" | "mission";
  entityId: number;
  entityName: string;
  timestamp: Date;
  expectedValue: number;
  actualValue: number;
  deviation: number;
  severity: "low" | "medium" | "high";
}

export interface ResourcePrediction {
  timeWindow: string;
  predictedJobCount: number;
  predictedMissionCount: number;
  predictedCpuDemand: number;
  predictedMemoryDemand: number;
  predictedCost: number;
  confidence: number;
}

export interface SchedulingRecommendation {
  entityType: "job" | "mission";
  entityId: number;
  entityName: string;
  recommendedSchedule: string;
  reason: string;
  expectedBenefit: string;
}

export class TemporalAnalyticsService {
  private patternCache: Map<string, TemporalPattern[]> = new Map();
  private anomalyCache: Map<string, Anomaly[]> = new Map();
  private cacheTTL = 3600000; // 1 hour

  /**
   * Detect temporal patterns in job execution
   */
  async detectJobPatterns(organizationId: number): Promise<TemporalPattern[]> {
    const cacheKey = `job-patterns-${organizationId}`;
    const cached = this.patternCache.get(cacheKey);
    if (cached) return cached;

    logger.info(`[TemporalAnalytics] Detecting job patterns for org ${organizationId}`);

    const patterns: TemporalPattern[] = [];

    // Get job execution data (simplified - would use actual execution logs)
    const orgJobs = await db.select().from(jobs).where(eq(jobs.organizationId, organizationId));

    // Group by hour of day
    const hourlyGroups = new Map<number, number[]>();
    for (const job of orgJobs) {
      const hour = job.createdAt?.getHours() || 0;
      if (!hourlyGroups.has(hour)) hourlyGroups.set(hour, []);
      hourlyGroups.get(hour)!.push(job.id);
    }

    for (const [hour, jobIds] of hourlyGroups) {
      patterns.push({
        type: "hourly",
        period: `${hour}:00`,
        count: jobIds.length,
        averageDuration: 1000, // Placeholder
        averageCost: 0.05, // Placeholder
        successRate: 0.95 // Placeholder
      });
    }

    // Group by day of week
    const dailyGroups = new Map<number, number[]>();
    for (const job of orgJobs) {
      const day = job.createdAt?.getDay() || 0;
      if (!dailyGroups.has(day)) dailyGroups.set(day, []);
      dailyGroups.get(day)!.push(job.id);
    }

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const [day, jobIds] of dailyGroups) {
      patterns.push({
        type: "daily",
        period: dayNames[day],
        count: jobIds.length,
        averageDuration: 1000,
        averageCost: 0.05,
        successRate: 0.95
      });
    }

    this.patternCache.set(cacheKey, patterns);
    return patterns;
  }

  /**
   * Detect anomalies in execution timing
   */
  async detectAnomalies(organizationId: number): Promise<Anomaly[]> {
    const cacheKey = `anomalies-${organizationId}`;
    const cached = this.anomalyCache.get(cacheKey);
    if (cached) return cached;

    logger.info(`[TemporalAnalytics] Detecting anomalies for org ${organizationId}`);

    const anomalies: Anomaly[] = [];

    // Get recent jobs
    const recentJobs = await db.select().from(jobs).where(
      and(
        eq(jobs.organizationId, organizationId),
        gte(jobs.createdAt, new Date(Date.now() - 86400000 * 7)) // Last 7 days
      )
    );

    // Calculate baseline metrics
    const allJobs = await db.select().from(jobs).where(eq(jobs.organizationId, organizationId));
    const avgCountPerDay = allJobs.length / 30; // Assume 30 days of data

    // Detect spikes
    const recentCount = recentJobs.length;
    const expectedCount = avgCountPerDay * 7; // Expected for 7 days

    if (recentCount > expectedCount * 2) {
      anomalies.push({
        type: "spike",
        entityType: "job",
        entityId: 0,
        entityName: "Overall job execution",
        timestamp: new Date(),
        expectedValue: expectedCount,
        actualValue: recentCount,
        deviation: (recentCount - expectedCount) / expectedCount,
        severity: recentCount > expectedCount * 3 ? "high" : "medium"
      });
    }

    // Detect drops
    if (recentCount < expectedCount * 0.5) {
      anomalies.push({
        type: "drop",
        entityType: "job",
        entityId: 0,
        entityName: "Overall job execution",
        timestamp: new Date(),
        expectedValue: expectedCount,
        actualValue: recentCount,
        deviation: (expectedCount - recentCount) / expectedCount,
        severity: recentCount < expectedCount * 0.25 ? "high" : "medium"
      });
    }

    this.anomalyCache.set(cacheKey, anomalies);
    return anomalies;
  }

  /**
   * Predict resource needs based on temporal patterns
   */
  async predictResourceNeeds(organizationId: number, hoursAhead: number = 24): Promise<ResourcePrediction[]> {
    logger.info(`[TemporalAnalytics] Predicting resource needs for org ${organizationId} (${hoursAhead}h ahead)`);

    const patterns = await this.detectJobPatterns(organizationId);
    const predictions: ResourcePrediction[] = [];

    // Generate hourly predictions
    const now = new Date();
    for (let i = 0; i < hoursAhead; i++) {
      const futureTime = new Date(now.getTime() + i * 3600000);
      const hour = futureTime.getHours();
      const day = futureTime.getDay();

      // Find matching pattern
      const hourlyPattern = patterns.find(p => p.type === "hourly" && parseInt(p.period) === hour);
      const dailyPattern = patterns.find(p => p.type === "daily" && p.period === ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]);

      const baseCount = hourlyPattern?.count || dailyPattern?.count || 0;

      predictions.push({
        timeWindow: futureTime.toISOString(),
        predictedJobCount: baseCount,
        predictedMissionCount: Math.floor(baseCount * 0.1), // Assume 10% are missions
        predictedCpuDemand: baseCount * 500, // 500 millicores per job
        predictedMemoryDemand: baseCount * 256, // 256MB per job
        predictedCost: baseCount * 0.05, // $0.05 per job
        confidence: 0.7 // Base confidence
      });
    }

    return predictions;
  }

  /**
   * Generate scheduling recommendations
   */
  async generateSchedulingRecommendations(organizationId: number): Promise<SchedulingRecommendation[]> {
    logger.info(`[TemporalAnalytics] Generating scheduling recommendations for org ${organizationId}`);

    const recommendations: SchedulingRecommendation[] = [];
    const patterns = await this.detectJobPatterns(organizationId);

    // Find peak hours
    const hourlyPatterns = patterns.filter(p => p.type === "hourly");
    hourlyPatterns.sort((a, b) => b.count - a.count);

    if (hourlyPatterns.length > 0) {
      const peakHour = hourlyPatterns[0];
      const offPeakHour = hourlyPatterns[hourlyPatterns.length - 1];

      recommendations.push({
        entityType: "job",
        entityId: 0,
        entityName: "Non-critical jobs",
        recommendedSchedule: `Schedule non-critical jobs during off-peak hours (${offPeakHour.period})`,
        reason: `Peak hour ${peakHour.period} has ${peakHour.period}x more executions than off-peak`,
        expectedBenefit: "Reduce resource contention by 30-40%"
      });
    }

    // Find peak days
    const dailyPatterns = patterns.filter(p => p.type === "daily");
    dailyPatterns.sort((a, b) => b.count - a.count);

    if (dailyPatterns.length > 0) {
      const peakDay = dailyPatterns[0];
      const offPeakDay = dailyPatterns[dailyPatterns.length - 1];

      recommendations.push({
        entityType: "mission",
        entityId: 0,
        entityName: "Long-running missions",
        recommendedSchedule: `Schedule long-running missions during off-peak days (${offPeakDay.period})`,
        reason: `Peak day ${peakDay.period} has ${peakDay.count} executions vs ${offPeakDay.count} on off-peak`,
        expectedBenefit: "Better resource availability and faster completion"
      });
    }

    return recommendations;
  }

  /**
   * Get temporal analytics statistics
   */
  async getTemporalStats(organizationId: number): Promise<{
    totalPatterns: number;
    totalAnomalies: number;
    peakHour: string;
    peakDay: string;
    averageDailyExecutions: number;
    predictedNextWeekCost: number;
  }> {
    const patterns = await this.detectJobPatterns(organizationId);
    const anomalies = await this.detectAnomalies(organizationId);

    // Find peak hour and day
    const hourlyPatterns = patterns.filter(p => p.type === "hourly");
    hourlyPatterns.sort((a, b) => b.count - a.count);
    const peakHour = hourlyPatterns[0]?.period || "N/A";

    const dailyPatterns = patterns.filter(p => p.type === "daily");
    dailyPatterns.sort((a, b) => b.count - a.count);
    const peakDay = dailyPatterns[0]?.period || "N/A";

    // Calculate average daily executions
    const totalExecutions = patterns.reduce((sum, p) => sum + p.count, 0);
    const averageDailyExecutions = totalExecutions / 30; // Assume 30 days

    // Predict next week cost
    const predictions = await this.predictResourceNeeds(organizationId, 168); // 7 days
    const predictedNextWeekCost = predictions.reduce((sum, p) => sum + p.predictedCost, 0);

    return {
      totalPatterns: patterns.length,
      totalAnomalies: anomalies.length,
      peakHour,
      peakDay,
      averageDailyExecutions,
      predictedNextWeekCost
    };
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    this.patternCache.clear();
    this.anomalyCache.clear();
    logger.info("[TemporalAnalytics] Caches cleared");
  }
}

// Singleton instance
export const temporalAnalyticsService = new TemporalAnalyticsService();
