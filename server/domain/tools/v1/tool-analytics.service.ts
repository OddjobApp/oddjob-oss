import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ToolAnalytics");

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Individual tool invocation record
 */
export interface ToolInvocation {
  id: string;
  jobId: number;
  jobType: string;
  toolName: string;
  timestamp: Date;
  params: any;
  result: any;
  success: boolean;
  error?: string;
  executionTimeMs: number;
  metadata: {
    agentId?: string;
    missionId?: number;
    pipelineId?: number;
    organizationId: number;
    userId?: number;
    source: "agent" | "pipeline" | "manual" | "composite";
  };
}

/**
 * Aggregated metrics for a tool/job
 */
export interface ToolUsageMetrics {
  jobId: number;
  toolName: string;
  jobType: string;
  // Usage counts
  totalInvocations: number;
  successfulInvocations: number;
  failedInvocations: number;
  // Rates
  successRate: number; // 0-1
  failureRate: number; // 0-1
  // Timing
  avgExecutionTimeMs: number;
  minExecutionTimeMs: number;
  maxExecutionTimeMs: number;
  p95ExecutionTimeMs: number;
  p99ExecutionTimeMs: number;
  // Patterns
  commonInputs: Array<{
    field: string;
    sampleValues: any[];
    valueTypes: string[];
    isRequired: boolean;
  }>;
  commonErrors: Array<{
    error: string;
    count: number;
    percentage: number;
    lastOccurred: Date;
    sampleParams?: any;
  }>;
  // Usage patterns
  peakUsageHours: number[]; // Hours 0-23 with most usage
  usageTrend: "increasing" | "decreasing" | "stable" | "volatile";
  // Users
  uniqueAgents: string[];
  uniqueUsers: number[];
  // Time range
  firstUsed: Date;
  lastUsed: Date;
}

/**
 * Organization-wide analytics
 */
export interface OrganizationAnalytics {
  organizationId: number;
  timeRange: { start: Date; end: Date };
  // Overview
  totalTools: number;
  totalInvocations: number;
  overallSuccessRate: number;
  // Top tools
  topTools: Array<{
    jobId: number;
    toolName: string;
    invocations: number;
    successRate: number;
  }>;
  // Category breakdown
  categoryBreakdown: Record<
    string,
    {
      count: number;
      invocations: number;
      successRate: number;
    }
  >;
  // Error summary
  topErrors: Array<{
    error: string;
    count: number;
    affectedTools: string[];
  }>;
  // Usage trends
  dailyUsage: Array<{
    date: string;
    invocations: number;
    successRate: number;
  }>;
}

/**
 * Optimization recommendation
 */
export interface OptimizationRecommendation {
  type: "performance" | "reliability" | "usability" | "security";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  impact: string;
  suggestedAction: string;
  effort: "easy" | "moderate" | "hard";
  metrics?: {
    currentValue: number;
    targetValue: number;
    unit: string;
  };
}

/**
 * Time series data point
 */
export interface TimeSeriesPoint {
  timestamp: Date;
  value: number;
  label?: string;
}

/**
 * Filter options for analytics queries
 */
export interface AnalyticsFilter {
  organizationId?: number;
  jobId?: number;
  jobType?: string;
  toolName?: string;
  agentId?: string;
  missionId?: number;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  source?: string;
}

// ============================================================================
// IN-MEMORY STORE (Production: Replace with database)
// ============================================================================

// Write-through: writes to DB for durability, keeps a short in-memory buffer for
// recent reads. Call initialize(db) at startup.
class AnalyticsStore {
  private db: any = null;
  private limit: number = 10000;
  // 60-second write buffer for hot-path reads without hitting DB on every call
  private recentBuffer: ToolInvocation[] = [];
  private readonly bufferWindowMs = 60_000;

  constructor(limit: number = 10000) {
    this.limit = limit;
  }

  async initialize(db: any): Promise<void> {
    this.db = db;
    logger.info("ToolAnalyticsStore initialized with DB backend");
  }

  private estimateSize(data: any): number {
    try { return JSON.stringify(data).length; } catch { return 0; }
  }

  private categorizeError(error: string): string {
    const lower = error.toLowerCase();
    if (lower.includes("timeout")) return "timeout";
    if (lower.includes("auth")) return "auth_error";
    if (lower.includes("not found")) return "not_found";
    if (lower.includes("rate limit")) return "rate_limit";
    return "execution_error";
  }

  add(invocation: ToolInvocation): void {
    if (this.recentBuffer.length >= this.limit) {
      this.recentBuffer.shift();
    }
    
    this.recentBuffer.push(invocation);

    // Persist to DB
    if (this.db) {
      this.persistInvocation(invocation).catch(err =>
        logger.error("ToolAnalyticsStore: failed to persist invocation", err)
      );
    }
  }

  private async persistInvocation(inv: ToolInvocation): Promise<void> {
    try {
      const { toolInvocations: t } = await import("@shared/schema/tool-invocations.js");
      await this.db.insert(t).values({
        id: inv.id, jobId: inv.jobId, jobType: inv.jobType, toolName: inv.toolName,
        organizationId: inv.metadata.organizationId || null,
        agentId: inv.metadata.agentId || null, missionId: inv.metadata.missionId || null,
        pipelineId: inv.metadata.pipelineId || null, userId: inv.metadata.userId || null,
        source: inv.metadata.source, success: inv.success,
        errorType: inv.error ? this.categorizeError(inv.error) : null,
        executionTimeMs: inv.executionTimeMs,
        inputSize: this.estimateSize(inv.params),
        outputSize: this.estimateSize(inv.result),
        invokedAt: inv.timestamp,
      }).onConflictDoNothing();
    } catch (err) { logger.error("ToolAnalyticsStore: DB persist error", err); }
  }

  async query(filter: AnalyticsFilter): Promise<ToolInvocation[]> {
    if (!this.db) return this.queryBuffer(filter);

    try {
      const { toolInvocations: t } = await import("@shared/schema/tool-invocations.js");
      const { eq, and, gte, lte } = await import("drizzle-orm");

      const conditions: any[] = [];
      if (filter.organizationId) conditions.push(eq(t.organizationId, filter.organizationId));
      if (filter.jobId) conditions.push(eq(t.jobId, filter.jobId));
      if (filter.jobType) conditions.push(eq(t.jobType, filter.jobType));
      if (filter.toolName) conditions.push(eq(t.toolName, filter.toolName));
      if (filter.agentId) conditions.push(eq(t.agentId, filter.agentId));
      if (filter.missionId) conditions.push(eq(t.missionId, filter.missionId));
      if (filter.success !== undefined) conditions.push(eq(t.success, filter.success));
      if (filter.source) conditions.push(eq(t.source, filter.source));
      if (filter.startDate) conditions.push(gte(t.invokedAt, filter.startDate));
      if (filter.endDate) conditions.push(lte(t.invokedAt, filter.endDate));

      const rows = await this.db.select().from(t)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(t.invokedAt)
        .limit(10000);

      return rows.map((r: any) => ({
        id: r.id, jobId: r.jobId, jobType: r.jobType, toolName: r.toolName,
        timestamp: r.invokedAt, params: {}, result: {}, success: r.success,
        error: undefined, executionTimeMs: r.executionTimeMs,
        metadata: { agentId: r.agentId ?? undefined, missionId: r.missionId ?? undefined,
          pipelineId: r.pipelineId ?? undefined, organizationId: r.organizationId ?? 0,
          userId: r.userId ?? undefined, source: r.source as any },
      }));
    } catch (err) {
      logger.error("ToolAnalyticsStore: query error, falling back to buffer", err);
      return this.queryBuffer(filter);
    }
  }

  private queryBuffer(filter: AnalyticsFilter): ToolInvocation[] {
    return this.recentBuffer.filter((inv) => {
      if (filter.organizationId && inv.metadata.organizationId !== filter.organizationId) return false;
      if (filter.jobId && inv.jobId !== filter.jobId) return false;
      if (filter.jobType && inv.jobType !== filter.jobType) return false;
      if (filter.toolName && inv.toolName !== filter.toolName) return false;
      if (filter.agentId && inv.metadata.agentId !== filter.agentId) return false;
      if (filter.missionId && inv.metadata.missionId !== filter.missionId) return false;
      if (filter.success !== undefined && inv.success !== filter.success) return false;
      if (filter.source && inv.metadata.source !== filter.source) return false;
      if (filter.startDate && inv.timestamp < filter.startDate) return false;
      if (filter.endDate && inv.timestamp > filter.endDate) return false;
      return true;
    });
  }

  async getAll(): Promise<ToolInvocation[]> { return this.query({}); }

  clear(): void { this.recentBuffer = []; }

  size(): number { return this.recentBuffer.length; }
}

// ============================================================================
// MAIN SERVICE
// ============================================================================

/**
 * ToolAnalyticsService
 *
 * Tracks, analyzes, and provides insights on tool usage patterns.
 * Enables optimization recommendations and usage analytics.
 */
export class ToolAnalyticsService {
  private store = new AnalyticsStore(50000); // Keep last 50k invocations

  /**
   * Record a tool invocation
   */
  async recordInvocation(
    jobId: number,
    jobType: string,
    toolName: string,
    params: any,
    result: any,
    metadata: {
      organizationId: number;
      executionTimeMs: number;
      success: boolean;
      error?: string;
      agentId?: string;
      missionId?: number;
      pipelineId?: number;
      userId?: number;
      source?: "agent" | "pipeline" | "manual" | "composite";
      timestamp?: Date;
    }
  ): Promise<void> {
    const invocation: ToolInvocation = {
      id: `inv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      jobId,
      jobType,
      toolName,
      timestamp: metadata.timestamp || new Date(),
      params,
      result,
      success: metadata.success,
      error: metadata.error,
      executionTimeMs: metadata.executionTimeMs,
      metadata: {
        organizationId: metadata.organizationId,
        agentId: metadata.agentId,
        missionId: metadata.missionId,
        pipelineId: metadata.pipelineId,
        userId: metadata.userId,
        source: metadata.source || "agent",
      },
    };

    this.store.add(invocation);

    logger.debug(`Recorded invocation: ${toolName} (${metadata.success ? "success" : "failure"})`);
  }

  /**
   * Get usage metrics for a specific job/tool
   */
  async getMetrics(
    jobId: number,
    timeRange?: { start: Date; end: Date }
  ): Promise<ToolUsageMetrics | null> {
    const filter: AnalyticsFilter = { jobId };
    if (timeRange) {
      filter.startDate = timeRange.start;
      filter.endDate = timeRange.end;
    }

    const invocations = await this.store.query(filter);

    if (invocations.length === 0) {
      return null;
    }

    // Basic counts
    const total = invocations.length;
    const successful = invocations.filter((i) => i.success).length;
    const failed = total - successful;

    // Timing stats
    const times = invocations.map((i) => i.executionTimeMs).sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = times[0];
    const max = times[times.length - 1];
    const p95 = times[Math.floor(times.length * 0.95)] || max;
    const p99 = times[Math.floor(times.length * 0.99)] || max;

    // Error analysis
    const errorCounts = new Map<string, number>();
    const errorSamples = new Map<string, any>();
    const errorLastSeen = new Map<string, Date>();

    for (const inv of invocations) {
      if (!inv.success && inv.error) {
        const count = errorCounts.get(inv.error) || 0;
        errorCounts.set(inv.error, count + 1);
        if (!errorSamples.has(inv.error)) {
          errorSamples.set(inv.error, inv.params);
        }
        errorLastSeen.set(inv.error, inv.timestamp);
      }
    }

    const commonErrors = Array.from(errorCounts.entries())
      .map(([error, count]) => ({
        error,
        count,
        percentage: count / failed,
        lastOccurred: errorLastSeen.get(error)!,
        sampleParams: errorSamples.get(error),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Input pattern analysis
    const fieldAnalysis = new Map<
      string,
      { values: any[]; types: Set<string>; required: boolean }
    >();

    for (const inv of invocations) {
      if (inv.params && typeof inv.params === "object") {
        for (const [key, value] of Object.entries(inv.params)) {
          if (!fieldAnalysis.has(key)) {
            fieldAnalysis.set(key, { values: [], types: new Set(), required: true });
          }
          const analysis = fieldAnalysis.get(key)!;
          analysis.values.push(value);
          analysis.types.add(typeof value);
          if (value === undefined || value === null) {
            analysis.required = false;
          }
        }
      }
    }

    const commonInputs = Array.from(fieldAnalysis.entries()).map(([field, data]) => ({
      field,
      sampleValues: data.values.slice(0, 5),
      valueTypes: Array.from(data.types),
      isRequired: data.required,
    }));

    // Peak usage hours
    const hourCounts = new Array(24).fill(0);
    for (const inv of invocations) {
      hourCounts[inv.timestamp.getUTCHours()]++;
    }
    const peakHours = hourCounts
      .map((count, hour) => ({ count, hour }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((h) => h.hour);

    // Unique users/agents
    const uniqueAgents = Array.from(
      new Set(invocations.map((i) => i.metadata.agentId).filter((id): id is string => !!id))
    );
    const uniqueUsers = Array.from(
      new Set(invocations.map((i) => i.metadata.userId).filter((id): id is number => !!id))
    );

    // Trend analysis (compare first half vs second half)
    const mid = Math.floor(invocations.length / 2);
    const firstHalf = invocations.slice(0, mid).length;
    const secondHalf = invocations.slice(mid).length;
    let usageTrend: "increasing" | "decreasing" | "stable" | "volatile";
    if (secondHalf > firstHalf * 1.2) {
      usageTrend = "increasing";
    } else if (secondHalf < firstHalf * 0.8) {
      usageTrend = "decreasing";
    } else {
      usageTrend = "stable";
    }

    // If high variance in daily usage, mark as volatile
    const dailyCounts = this.getDailyCounts(invocations);
    if (dailyCounts.length > 7) {
      const variance = this.calculateVariance(dailyCounts.map((d) => d.count));
      if (variance > 100) {
        usageTrend = "volatile";
      }
    }

    return {
      jobId,
      toolName: invocations[0].toolName,
      jobType: invocations[0].jobType,
      totalInvocations: total,
      successfulInvocations: successful,
      failedInvocations: failed,
      successRate: successful / total,
      failureRate: failed / total,
      avgExecutionTimeMs: avg,
      minExecutionTimeMs: min,
      maxExecutionTimeMs: max,
      p95ExecutionTimeMs: p95,
      p99ExecutionTimeMs: p99,
      commonInputs,
      commonErrors,
      peakUsageHours: peakHours,
      usageTrend,
      uniqueAgents,
      uniqueUsers,
      firstUsed: invocations[0].timestamp,
      lastUsed: invocations[invocations.length - 1].timestamp,
    };
  }

  /**
   * Get organization-wide analytics
   */
  async getOrganizationAnalytics(
    organizationId: number,
    timeRange?: { start: Date; end: Date }
  ): Promise<OrganizationAnalytics> {
    const filter: AnalyticsFilter = { organizationId };
    if (timeRange) {
      filter.startDate = timeRange.start;
      filter.endDate = timeRange.end;
    }

    const invocations = await this.store.query(filter);

    if (invocations.length === 0) {
      return {
        organizationId,
        timeRange: timeRange || { start: new Date(), end: new Date() },
        totalTools: 0,
        totalInvocations: 0,
        overallSuccessRate: 0,
        topTools: [],
        categoryBreakdown: {},
        topErrors: [],
        dailyUsage: [],
      };
    }

    // Group by tool
    const toolGroups = new Map<number, ToolInvocation[]>();
    for (const inv of invocations) {
      if (!toolGroups.has(inv.jobId)) {
        toolGroups.set(inv.jobId, []);
      }
      toolGroups.get(inv.jobId)!.push(inv);
    }

    // Top tools
    const topTools = Array.from(toolGroups.entries())
      .map(([jobId, invs]) => {
        const successful = invs.filter((i) => i.success).length;
        return {
          jobId,
          toolName: invs[0].toolName,
          invocations: invs.length,
          successRate: successful / invs.length,
        };
      })
      .sort((a, b) => b.invocations - a.invocations)
      .slice(0, 10);

    // Category breakdown (would need category mapping from job type)
    const categoryBreakdown: OrganizationAnalytics["categoryBreakdown"] = {};
    for (const inv of invocations) {
      // Simple categorization by job type patterns
      let category = "other";
      if (inv.jobType.includes("ai")) category = "ai";
      else if (inv.jobType.includes("sql") || inv.jobType.includes("db")) category = "database";
      else if (inv.jobType.includes("curl") || inv.jobType.includes("http")) category = "http";
      else if (inv.jobType.includes("file")) category = "file";
      else if (inv.jobType.includes("slack") || inv.jobType.includes("email")) category = "notification";

      if (!categoryBreakdown[category]) {
        categoryBreakdown[category] = { count: 0, invocations: 0, successRate: 0 };
      }
      categoryBreakdown[category].count++;
      categoryBreakdown[category].invocations++;
    }

    // Calculate success rates for categories
    for (const category of Object.keys(categoryBreakdown)) {
      const catInvs = invocations.filter((inv) => {
        if (category === "ai") return inv.jobType.includes("ai");
        if (category === "database") return inv.jobType.includes("sql") || inv.jobType.includes("db");
        if (category === "http") return inv.jobType.includes("curl") || inv.jobType.includes("http");
        if (category === "file") return inv.jobType.includes("file");
        if (category === "notification") return inv.jobType.includes("slack") || inv.jobType.includes("email");
        return true;
      });
      const successful = catInvs.filter((i) => i.success).length;
      categoryBreakdown[category].successRate = successful / catInvs.length;
    }

    // Top errors
    const errorCounts = new Map<string, { count: number; tools: Set<string> }>();
    for (const inv of invocations) {
      if (!inv.success && inv.error) {
        const existing = errorCounts.get(inv.error);
        if (existing) {
          existing.count++;
          existing.tools.add(inv.toolName);
        } else {
          errorCounts.set(inv.error, { count: 1, tools: new Set([inv.toolName]) });
        }
      }
    }

    const topErrors = Array.from(errorCounts.entries())
      .map(([error, data]) => ({
        error,
        count: data.count,
        affectedTools: Array.from(data.tools),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Daily usage
    const dailyUsage = this.getDailyCounts(invocations).map((d) => ({
      date: d.date,
      invocations: d.count,
      successRate: d.successful / d.count,
    }));

    const successful = invocations.filter((i) => i.success).length;

    return {
      organizationId,
      timeRange: timeRange || {
        start: invocations[0].timestamp,
        end: invocations[invocations.length - 1].timestamp,
      },
      totalTools: toolGroups.size,
      totalInvocations: invocations.length,
      overallSuccessRate: successful / invocations.length,
      topTools,
      categoryBreakdown,
      topErrors,
      dailyUsage,
    };
  }

  /**
   * Generate optimization recommendations for a job
   */
  async generateRecommendations(jobId: number): Promise<OptimizationRecommendation[]> {
    const metrics = await this.getMetrics(jobId);

    if (!metrics) {
      return [];
    }

    const recommendations: OptimizationRecommendation[] = [];

    // Performance recommendations
    if (metrics.avgExecutionTimeMs > 5000) {
      recommendations.push({
        type: "performance",
        severity: metrics.avgExecutionTimeMs > 30000 ? "high" : "medium",
        title: "Slow Execution Time",
        description: `Average execution time is ${Math.round(metrics.avgExecutionTimeMs / 1000)}s`,
        impact: "May cause timeouts and poor user experience",
        suggestedAction: "Consider optimizing the job logic or adding caching",
        effort: "moderate",
        metrics: {
          currentValue: metrics.avgExecutionTimeMs,
          targetValue: 5000,
          unit: "ms",
        },
      });
    }

    // Reliability recommendations
    if (metrics.successRate < 0.95) {
      recommendations.push({
        type: "reliability",
        severity: metrics.successRate < 0.8 ? "critical" : metrics.successRate < 0.9 ? "high" : "medium",
        title: "Low Success Rate",
        description: `Only ${Math.round(metrics.successRate * 100)}% of invocations succeed`,
        impact: "Unreliable tool that may break workflows",
        suggestedAction: `Review top errors: ${metrics.commonErrors.slice(0, 3).map((e) => e.error).join(", ")}`,
        effort: "hard",
        metrics: {
          currentValue: metrics.successRate,
          targetValue: 0.95,
          unit: "rate",
        },
      });
    }

    // Error pattern recommendations
    if (metrics.commonErrors.length > 0) {
      const topError = metrics.commonErrors[0];
      if (topError.percentage > 0.5) {
        recommendations.push({
          type: "reliability",
          severity: "high",
          title: "Dominant Error Pattern",
          description: `"${topError.error}" accounts for ${Math.round(topError.percentage * 100)}% of failures`,
          impact: "Single point of failure affecting most users",
          suggestedAction: "Add input validation or improve error handling",
          effort: "moderate",
        });
      }
    }

    // Usage recommendations
    if (metrics.totalInvocations > 1000 && metrics.usageTrend === "decreasing") {
      recommendations.push({
        type: "usability",
        severity: "low",
        title: "Declining Usage",
        description: "Usage is trending down despite high historical volume",
        impact: "May indicate users finding alternatives or workarounds",
        suggestedAction: "Gather user feedback or consider deprecation",
        effort: "easy",
      });
    }

    // Peak usage recommendations
    if (metrics.peakUsageHours.length > 0) {
      const peakHour = metrics.peakUsageHours[0];
      if (peakHour >= 9 && peakHour <= 17) {
        recommendations.push({
          type: "performance",
          severity: "low",
          title: "Business Hours Peak",
          description: `Peak usage at ${peakHour}:00 (business hours)`,
          impact: "May experience contention during busy periods",
          suggestedAction: "Consider rate limiting or capacity planning",
          effort: "moderate",
        });
      }
    }

    return recommendations.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Get time series data for visualization
   */
  async getTimeSeries(
    metric: "invocations" | "successRate" | "executionTime",
    filter: AnalyticsFilter,
    granularity: "hour" | "day" | "week" = "day"
  ): Promise<TimeSeriesPoint[]> {
    const invocations = await this.store.query(filter);

    if (invocations.length === 0) {
      return [];
    }

    // Group by time period
    const grouped = new Map<string, ToolInvocation[]>();

    for (const inv of invocations) {
      let key: string;
      const date = inv.timestamp;

      switch (granularity) {
        case "hour":
          key = `${date.toISOString().split("T")[0]}_${date.getHours()}`;
          break;
        case "day":
          key = date.toISOString().split("T")[0];
          break;
        case "week":
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split("T")[0];
          break;
      }

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(inv);
    }

    // Calculate metric for each period
    return Array.from(grouped.entries())
      .map(([key, invs]) => {
        let value: number;

        switch (metric) {
          case "invocations":
            value = invs.length;
            break;
          case "successRate":
            const successful = invs.filter((i) => i.success).length;
            value = successful / invs.length;
            break;
          case "executionTime":
            value = invs.reduce((sum, i) => sum + i.executionTimeMs, 0) / invs.length;
            break;
          default:
            value = 0;
        }

        return {
          timestamp: new Date(invs[0].timestamp),
          value,
          label: key,
        };
      })
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Compare two time periods
   */
  async comparePeriods(
    jobId: number,
    period1: { start: Date; end: Date },
    period2: { start: Date; end: Date }
  ): Promise<{
    period1: Partial<ToolUsageMetrics>;
    period2: Partial<ToolUsageMetrics>;
    changes: {
      invocations: { absolute: number; percentage: number };
      successRate: { absolute: number; percentage: number };
      avgExecutionTime: { absolute: number; percentage: number };
    };
  }> {
    const m1 = await this.getMetrics(jobId, period1);
    const m2 = await this.getMetrics(jobId, period2);

    const changes = {
      invocations: {
        absolute: (m2?.totalInvocations || 0) - (m1?.totalInvocations || 0),
        percentage: m1?.totalInvocations
          ? ((m2?.totalInvocations || 0) - m1.totalInvocations) / m1.totalInvocations
          : 0,
      },
      successRate: {
        absolute: (m2?.successRate || 0) - (m1?.successRate || 0),
        percentage: m1?.successRate
          ? ((m2?.successRate || 0) - m1.successRate) / m1.successRate
          : 0,
      },
      avgExecutionTime: {
        absolute: (m2?.avgExecutionTimeMs || 0) - (m1?.avgExecutionTimeMs || 0),
        percentage: m1?.avgExecutionTimeMs
          ? ((m2?.avgExecutionTimeMs || 0) - m1.avgExecutionTimeMs) / m1.avgExecutionTimeMs
          : 0,
      },
    };

    return {
      period1: m1 || { totalInvocations: 0, successRate: 0, avgExecutionTimeMs: 0 },
      period2: m2 || { totalInvocations: 0, successRate: 0, avgExecutionTimeMs: 0 },
      changes,
    };
  }

  /**
   * Get analytics summary for dashboard
   */
  async getDashboardSummary(organizationId: number): Promise<{
    totalInvocations24h: number;
    successRate24h: number;
    avgExecutionTime24h: number;
    topErrors24h: Array<{ error: string; count: number }>;
    mostUsedTools: Array<{ toolName: string; invocations: number }>;
    trending: "up" | "down" | "stable";
  }> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentInvs = await this.store.query({
      organizationId,
      startDate: yesterday,
      endDate: now,
    });

    const successful = recentInvs.filter((i) => i.success).length;
    const total = recentInvs.length;

    const toolCounts = new Map<string, number>();
    const errorCounts = new Map<string, number>();

    for (const inv of recentInvs) {
      toolCounts.set(inv.toolName, (toolCounts.get(inv.toolName) || 0) + 1);
      if (!inv.success && inv.error) {
        errorCounts.set(inv.error, (errorCounts.get(inv.error) || 0) + 1);
      }
    }

    // Compare with previous 24h for trend
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const previousInvs = await this.store.query({
      organizationId,
      startDate: twoDaysAgo,
      endDate: yesterday,
    });

    let trending: "up" | "down" | "stable";
    if (total > previousInvs.length * 1.2) {
      trending = "up";
    } else if (total < previousInvs.length * 0.8) {
      trending = "down";
    } else {
      trending = "stable";
    }

    return {
      totalInvocations24h: total,
      successRate24h: total > 0 ? successful / total : 0,
      avgExecutionTime24h:
        total > 0
          ? recentInvs.reduce((sum, i) => sum + i.executionTimeMs, 0) / total
          : 0,
      topErrors24h: Array.from(errorCounts.entries())
        .map(([error, count]) => ({ error, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      mostUsedTools: Array.from(toolCounts.entries())
        .map(([toolName, invocations]) => ({ toolName, invocations }))
        .sort((a, b) => b.invocations - a.invocations)
        .slice(0, 5),
      trending,
    };
  }

  /**
   * Clear all analytics data
   */
  async clearData(): Promise<void> {
    this.store.clear();
    logger.info("Cleared all analytics data");
  }

  /**
   * Get store statistics
   */
  getStats(): { totalInvocations: number; memorySize: number } {
    return {
      totalInvocations: this.store.size(),
      memorySize: this.store.size() * 1024, // Rough estimate
    };
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private getDailyCounts(
    invocations: ToolInvocation[]
  ): Array<{ date: string; count: number; successful: number }> {
    const daily = new Map<string, { count: number; successful: number }>();

    for (const inv of invocations) {
      const date = inv.timestamp.toISOString().split("T")[0];
      const existing = daily.get(date) || { count: 0, successful: 0 };
      existing.count++;
      if (inv.success) existing.successful++;
      daily.set(date, existing);
    }

    return Array.from(daily.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }
}

// ============================================================================
// SERVICE INSTANCE
// ============================================================================

export const toolAnalyticsService = new ToolAnalyticsService();

// Hydrate store from DB at startup
import("@server/database_service.js").then(({ db }) => {
  (toolAnalyticsService as any).store.initialize(db).catch((err: any) =>
    logger.warn("ToolAnalyticsStore DB init failed — using in-memory fallback:", err)
  );
}).catch(() => {});
