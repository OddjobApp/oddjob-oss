import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@server/domain/core/infrastructure/event-stream.service.js";
import { upskillingOrchestratorService } from "./upskilling-orchestrator.service.js";

const logger = createLogger("PerformanceManager");

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Performance threshold configuration
 */
export interface PerformanceThreshold {
  reliabilityMin: number; // 0-1, minimum success rate
  costEfficiencyMax: number; // Max cost per successful operation
  missionCountMin: number; // Minimum missions to evaluate
  evaluationWindowDays: number; // Lookback period
}

/**
 * Agent performance record
 */
export interface AgentPerformance {
  agentId: string;
  organizationId: number;
  // Reliability metrics
  totalMissions: number;
  successfulMissions: number;
  failedMissions: number;
  successRate: number; // 0-1
  // Cost metrics
  totalCost: number; // Tokens spent
  avgCostPerMission: number;
  costPerSuccess: number;
  // Efficiency score
  efficiencyScore: number; // 0-1 composite
  // Trend
  trend: "improving" | "declining" | "stable";
  // Status
  status: "active" | "probation" | "pip" | "deprovisioned";
  // Timeline
  firstMissionAt: Date;
  lastMissionAt: Date;
  lastEvaluatedAt: Date;
}

/**
 * Performance Improvement Plan (PIP)
 */
export interface PerformanceImprovementPlan {
  id: string;
  agentId: string;
  organizationId: number;
  status: "pending" | "active" | "completed" | "failed";
  // Trigger reasons
  triggerReason: string;
  thresholdFailed: string;
  // Plan details
  targetSuccessRate: number;
  targetCostEfficiency: number;
  deadlineDays: number;
  startedAt?: Date;
  completedAt?: Date;
  // Actions taken
  upskillingAttempts: number;
  retrainingSessions: number;
  // Results
  finalSuccessRate?: number;
  finalCostEfficiency?: number;
  outcome?: "promoted" | "terminated" | "extended";
}

/**
 * Upskilling job status
 */
export interface UpskillingJob {
  id: string;
  agentId: string;
  pipId: string;
  status: "queued" | "training" | "completed" | "failed";
  type: "fine_tuning" | "golden_samples" | "prompt_optimization";
  // Training details
  datasetId?: string;
  modelId?: string;
  externalJobId?: string; // OpenAI/Anthropic job ID
  // Progress
  progressPercent: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Performance evaluation result
 */
export interface EvaluationResult {
  agentId: string;
  previousStatus: string;
  newStatus: string;
  actionRequired: "none" | "warn" | "pip" | "terminate";
  reasons: string[];
  metrics: {
    successRate: number;
    costPerSuccess: number;
    efficiencyScore: number;
  };
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_THRESHOLDS: PerformanceThreshold = {
  reliabilityMin: 0.7, // 70% success rate minimum
  costEfficiencyMax: 10000, // 10k tokens per success max
  missionCountMin: 5, // Need at least 5 missions to evaluate
  evaluationWindowDays: 30, // Look at last 30 days
};

const PIP_CONFIGURATION = {
  deadlineDays: 14, // 2 weeks to improve
  targetSuccessRate: 0.75, // 75% success rate to pass
  maxUpskillingAttempts: 3,
  retrainingDatasetSize: 50, // Number of examples for fine-tuning
};

// ============================================================================
// IN-MEMORY STORE (Production: Database)
// ============================================================================

// Write-through: reads from in-memory Maps (fast), writes to DB for durability.
// Call initialize(db) at startup to hydrate Maps from DB.
class PerformanceStore {
  private performances = new Map<string, AgentPerformance>();
  private pips = new Map<string, PerformanceImprovementPlan>();
  private upskillingJobs = new Map<string, UpskillingJob>();
  private db: any = null;

  async initialize(db: any): Promise<void> {
    this.db = db;
    const { agentPerformances, performanceImprovementPlans, agentUpskillingJobs } =
      await import("@shared/schema/agent-performance.js");

    const { eq: eqFn, inArray: inArrayFn } = await import("drizzle-orm");
    const [dbPerfs, dbPips, dbJobs] = await Promise.all([
      db.select().from(agentPerformances),
      // Only load non-terminal PIPs — completed/failed ones are not needed in the active store
      db.select().from(performanceImprovementPlans)
        .where(inArrayFn(performanceImprovementPlans.status, ['active', 'pending', 'at_risk'])),
      // Only load in-flight upskilling jobs
      db.select().from(agentUpskillingJobs)
        .where(inArrayFn(agentUpskillingJobs.status, ['queued', 'running'])),
    ]);

    for (const p of dbPerfs) {
      this.performances.set(`${p.agentId}-${p.organizationId}`, {
        agentId: p.agentId, organizationId: p.organizationId,
        totalMissions: p.totalMissions, successfulMissions: p.successfulMissions,
        failedMissions: p.failedMissions, successRate: parseFloat(String(p.successRate)),
        totalCost: p.totalCost, avgCostPerMission: parseFloat(String(p.avgCostPerMission)),
        costPerSuccess: parseFloat(String(p.costPerSuccess)),
        efficiencyScore: parseFloat(String(p.efficiencyScore)),
        trend: p.trend as any, status: p.status as any,
        firstMissionAt: p.firstMissionAt ?? new Date(),
        lastMissionAt: p.lastMissionAt ?? new Date(),
        lastEvaluatedAt: p.lastEvaluatedAt,
      });
    }
    for (const pip of dbPips) {
      this.pips.set(pip.id, {
        id: pip.id, agentId: pip.agentId, organizationId: pip.organizationId,
        status: pip.status as any, startedAt: pip.startedAt, deadlineDays: pip.deadlineDays,
        triggerReason: pip.triggerReason || 'Unknown',
        thresholdFailed: pip.thresholdFailed || 'Unknown',
        targetSuccessRate: parseFloat(String(pip.targetSuccessRate)),
        targetCostEfficiency: parseFloat(String(pip.targetCostEfficiency)),
        upskillingAttempts: pip.upskillingAttempts,
        retrainingSessions: pip.retrainingSessions,
        completedAt: pip.completedAt ?? undefined, outcome: pip.outcome as any ?? undefined,
        finalSuccessRate: pip.finalSuccessRate != null ? parseFloat(String(pip.finalSuccessRate)) : undefined,
        finalCostEfficiency: pip.finalCostEfficiency != null ? parseFloat(String(pip.finalCostEfficiency)) : undefined,
      });
    }
    for (const job of dbJobs) {
      this.upskillingJobs.set(job.id, {
        id: job.id, agentId: job.agentId, pipId: job.pipId,
        status: job.status as any, type: job.type as any,
        datasetId: job.datasetId ?? undefined, modelId: job.modelId ?? undefined,
        externalJobId: job.externalJobId ?? undefined, progressPercent: job.progressPercent,
        startedAt: job.startedAt ?? undefined, completedAt: job.completedAt ?? undefined,
        error: job.error ?? undefined,
      });
    }
    logger.info(`PerformanceStore loaded: ${dbPerfs.length} performances, ${dbPips.length} PIPs, ${dbJobs.length} upskilling jobs`);
  }

  private async persistPerf(perf: AgentPerformance): Promise<void> {
    if (!this.db) return;
    try {
      const { agentPerformances: t } = await import("@shared/schema/agent-performance.js");
      const id = `${perf.agentId}-${perf.organizationId}`;
      await this.db.insert(t).values({ id, agentId: perf.agentId, organizationId: perf.organizationId,
        totalMissions: perf.totalMissions, successfulMissions: perf.successfulMissions,
        failedMissions: perf.failedMissions, successRate: String(perf.successRate),
        totalCost: perf.totalCost, avgCostPerMission: String(perf.avgCostPerMission),
        costPerSuccess: String(perf.costPerSuccess), efficiencyScore: String(perf.efficiencyScore),
        trend: perf.trend, status: perf.status,
        firstMissionAt: perf.firstMissionAt, lastMissionAt: perf.lastMissionAt,
        lastEvaluatedAt: perf.lastEvaluatedAt })
        .onConflictDoUpdate({ target: t.id, set: { totalMissions: perf.totalMissions,
          successfulMissions: perf.successfulMissions, failedMissions: perf.failedMissions,
          successRate: String(perf.successRate), totalCost: perf.totalCost,
          avgCostPerMission: String(perf.avgCostPerMission),
          costPerSuccess: String(perf.costPerSuccess), efficiencyScore: String(perf.efficiencyScore),
          trend: perf.trend, status: perf.status, lastMissionAt: perf.lastMissionAt,
          lastEvaluatedAt: perf.lastEvaluatedAt, updatedAt: new Date() } });
    } catch (err) { logger.error("PerformanceStore: failed to persist performance", err); }
  }

  private async persistPip(pip: PerformanceImprovementPlan): Promise<void> {
    if (!this.db) return;
    try {
      const { performanceImprovementPlans: t } = await import("@shared/schema/agent-performance.js");
      await this.db.insert(t).values({ id: pip.id, agentId: pip.agentId, organizationId: pip.organizationId,
        status: pip.status, startedAt: pip.startedAt, deadlineDays: pip.deadlineDays,
        triggerReason: pip.triggerReason,
        thresholdFailed: pip.thresholdFailed,
        targetSuccessRate: String(pip.targetSuccessRate),
        targetCostEfficiency: String(pip.targetCostEfficiency),
        upskillingAttempts: pip.upskillingAttempts,
        retrainingSessions: pip.retrainingSessions,
        completedAt: pip.completedAt ?? null, outcome: pip.outcome ?? null,
        finalSuccessRate: pip.finalSuccessRate != null ? String(pip.finalSuccessRate) : null,
        finalCostEfficiency: pip.finalCostEfficiency != null ? String(pip.finalCostEfficiency) : null })
        .onConflictDoUpdate({ target: t.id, set: { status: pip.status,
          upskillingAttempts: pip.upskillingAttempts, 
          retrainingSessions: pip.retrainingSessions,
          completedAt: pip.completedAt ?? null,
          outcome: pip.outcome ?? null,
          finalSuccessRate: pip.finalSuccessRate != null ? String(pip.finalSuccessRate) : null,
          finalCostEfficiency: pip.finalCostEfficiency != null ? String(pip.finalCostEfficiency) : null,
          updatedAt: new Date() } });
    } catch (err) { logger.error("PerformanceStore: failed to persist PIP", err); }
  }

  private async persistUpskilling(job: UpskillingJob): Promise<void> {
    if (!this.db) return;
    try {
      const { agentUpskillingJobs: t } = await import("@shared/schema/agent-performance.js");
      await this.db.insert(t).values({ id: job.id, agentId: job.agentId, pipId: job.pipId,
        status: job.status, type: job.type, datasetId: job.datasetId ?? null,
        modelId: job.modelId ?? null, externalJobId: job.externalJobId ?? null,
        progressPercent: job.progressPercent, startedAt: job.startedAt ?? null,
        completedAt: job.completedAt ?? null, error: job.error ?? null })
        .onConflictDoUpdate({ target: t.id, set: { status: job.status,
          progressPercent: job.progressPercent, modelId: job.modelId ?? null,
          externalJobId: job.externalJobId ?? null, startedAt: job.startedAt ?? null,
          completedAt: job.completedAt ?? null, error: job.error ?? null,
          updatedAt: new Date() } });
    } catch (err) { logger.error("PerformanceStore: failed to persist upskilling job", err); }
  }

  setPerformance(perf: AgentPerformance): void {
    this.performances.set(`${perf.agentId}-${perf.organizationId}`, perf);
    this.persistPerf(perf).catch(() => {});
  }

  getPerformance(agentId: string, orgId: number): AgentPerformance | undefined {
    return this.performances.get(`${agentId}-${orgId}`);
  }

  getAllPerformances(orgId: number): AgentPerformance[] {
    return Array.from(this.performances.values()).filter((p) => p.organizationId === orgId);
  }

  setPip(pip: PerformanceImprovementPlan): void {
    this.pips.set(pip.id, pip);
    this.persistPip(pip).catch(() => {});
  }

  getPip(id: string): PerformanceImprovementPlan | undefined { return this.pips.get(id); }

  getActivePip(agentId: string, orgId: number): PerformanceImprovementPlan | undefined {
    return Array.from(this.pips.values()).find(
      (p) => p.agentId === agentId && p.organizationId === orgId && (p.status === "active" || p.status === "pending")
    );
  }

  getPipsForAgent(agentId: string, orgId: number): PerformanceImprovementPlan[] {
    return Array.from(this.pips.values()).filter(
      (p) => p.agentId === agentId && p.organizationId === orgId
    );
  }

  getAllPipsForOrg(orgId: number): PerformanceImprovementPlan[] {
    return Array.from(this.pips.values()).filter((p) => p.organizationId === orgId);
  }

  setUpskilling(job: UpskillingJob): void {
    this.upskillingJobs.set(job.id, job);
    this.persistUpskilling(job).catch(() => {});
  }

  getUpskilling(id: string): UpskillingJob | undefined { return this.upskillingJobs.get(id); }

  getUpskillingForPip(pipId: string): UpskillingJob[] {
    return Array.from(this.upskillingJobs.values()).filter((j) => j.pipId === pipId);
  }

  clear(): void {
    this.performances.clear();
    this.pips.clear();
    this.upskillingJobs.clear();
  }
}

// ============================================================================
// MAIN SERVICE
// ============================================================================

/**
 * PerformanceManagerService
 *
 * Manages agent performance monitoring, PIP (Performance Improvement Plans),
 * autonomous upskilling, and agent lifecycle decisions.
 */
export class PerformanceManagerService {
  private store = new PerformanceStore();
  private thresholds: PerformanceThreshold;

  constructor(thresholds: Partial<PerformanceThreshold> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Evaluate an agent's performance
   */
  async evaluateAgent(
    agentId: string,
    organizationId: number,
    missionHistory: Array<{
      missionId: number;
      success: boolean;
      cost: number;
      timestamp: Date;
    }>
  ): Promise<EvaluationResult> {
    const previousPerf = this.store.getPerformance(agentId, organizationId);
    const previousStatus = previousPerf?.status || "active";

    // Calculate metrics
    const recentMissions = this.filterRecentMissions(
      missionHistory,
      this.thresholds.evaluationWindowDays
    );

    if (recentMissions.length < this.thresholds.missionCountMin) {
      return {
        agentId,
        previousStatus,
        newStatus: previousStatus,
        actionRequired: "none",
        reasons: ["Insufficient mission history for evaluation"],
        metrics: previousPerf
          ? {
              successRate: previousPerf.successRate,
              costPerSuccess: previousPerf.costPerSuccess,
              efficiencyScore: previousPerf.efficiencyScore,
            }
          : { successRate: 0, costPerSuccess: 0, efficiencyScore: 0 },
      };
    }

    const successful = recentMissions.filter((m) => m.success).length;
    const totalCost = recentMissions.reduce((sum, m) => sum + m.cost, 0);

    const successRate = successful / recentMissions.length;
    const avgCost = totalCost / recentMissions.length;
    const costPerSuccess = successful > 0 ? totalCost / successful : Infinity;

    // Calculate efficiency score (composite metric)
    const successScore = successRate;
    const costScore = Math.max(0, 1 - costPerSuccess / this.thresholds.costEfficiencyMax);
    const efficiencyScore = (successScore + costScore) / 2;

    // Determine trend
    let trend: "improving" | "declining" | "stable" = "stable";
    if (previousPerf) {
      const halfPoint = Math.floor(recentMissions.length / 2);
      const firstHalfSuccess = recentMissions
        .slice(0, halfPoint)
        .filter((m) => m.success).length;
      const secondHalfSuccess = recentMissions
        .slice(halfPoint)
        .filter((m) => m.success).length;
      const firstHalfRate = firstHalfSuccess / halfPoint;
      const secondHalfRate = secondHalfSuccess / (recentMissions.length - halfPoint);

      if (secondHalfRate > firstHalfRate * 1.1) trend = "improving";
      else if (secondHalfRate < firstHalfRate * 0.9) trend = "declining";
    }

    // Update performance record
    const performance: AgentPerformance = {
      agentId,
      organizationId,
      totalMissions: recentMissions.length,
      successfulMissions: successful,
      failedMissions: recentMissions.length - successful,
      successRate,
      totalCost,
      avgCostPerMission: avgCost,
      costPerSuccess,
      efficiencyScore,
      trend,
      status: previousStatus,
      firstMissionAt: previousPerf?.firstMissionAt || recentMissions[0]?.timestamp || new Date(),
      lastMissionAt: recentMissions[recentMissions.length - 1]?.timestamp || new Date(),
      lastEvaluatedAt: new Date(),
    };

    this.store.setPerformance(performance);

    // Determine action required
    const result = this.determineAction(performance, previousStatus);
    result.metrics = { successRate, costPerSuccess, efficiencyScore };

    // Update status if changed
    if (result.newStatus !== previousStatus) {
      performance.status = result.newStatus as AgentPerformance["status"];
      this.store.setPerformance(performance);

      logger.info(`Agent ${agentId} status changed: ${previousStatus} → ${result.newStatus}`, {
        reasons: result.reasons,
      });

      // Publish event
      eventStream.publish(
        "agent.status_changed",
        {
          agentId,
          previousStatus,
          newStatus: result.newStatus,
          reasons: result.reasons,
          metrics: result.metrics,
        },
        { organizationId },
        "performance_manager"
      );
    }

    return result;
  }

  /**
   * Create a Performance Improvement Plan (PIP)
   */
  async createPIP(
    agentId: string,
    organizationId: number,
    triggerReason: string,
    thresholdFailed: string
  ): Promise<PerformanceImprovementPlan> {
    // Check if there's already an active PIP
    const existing = this.store.getActivePip(agentId, organizationId);
    if (existing) {
      throw new Error(`Active PIP already exists for agent ${agentId}`);
    }

    const id = `pip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const pip: PerformanceImprovementPlan = {
      id,
      agentId,
      organizationId,
      status: "pending",
      triggerReason,
      thresholdFailed,
      targetSuccessRate: PIP_CONFIGURATION.targetSuccessRate,
      targetCostEfficiency: this.thresholds.costEfficiencyMax * 0.8,
      deadlineDays: PIP_CONFIGURATION.deadlineDays,
      upskillingAttempts: 0,
      retrainingSessions: 0,
    };

    this.store.setPip(pip);

    logger.info(`Created PIP for agent ${agentId}`, {
      reason: triggerReason,
      threshold: thresholdFailed,
    });

    // Publish event
    eventStream.publish(
      "agent.pip_created",
      {
        pipId: id,
        agentId,
        triggerReason,
        thresholdFailed,
        deadlineDays: PIP_CONFIGURATION.deadlineDays,
      },
      { organizationId },
      "performance_manager"
    );

    return pip;
  }

  /**
   * Start a PIP (activate it)
   */
  async startPIP(pipId: string): Promise<PerformanceImprovementPlan> {
    const pip = this.store.getPip(pipId);
    if (!pip) {
      throw new Error(`PIP ${pipId} not found`);
    }

    if (pip.status !== "pending") {
      throw new Error(`PIP ${pipId} is already ${pip.status}`);
    }

    pip.status = "active";
    pip.startedAt = new Date();

    this.store.setPip(pip);

    // Trigger initial upskilling
    await this.initiateUpskilling(pip.agentId, pip.organizationId, pip.id, "fine_tuning");

    logger.info(`Started PIP ${pipId} for agent ${pip.agentId}`);

    eventStream.publish(
      "agent.pip_started",
      {
        pipId,
        agentId: pip.agentId,
        startedAt: pip.startedAt,
      },
      { organizationId: pip.organizationId },
      "performance_manager"
    );

    return pip;
  }

  /**
   * Complete a PIP and determine outcome
   */
  async completePIP(
    pipId: string,
    finalMetrics: {
      successRate: number;
      costEfficiency: number;
    }
  ): Promise<PerformanceImprovementPlan> {
    const pip = this.store.getPip(pipId);
    if (!pip) {
      throw new Error(`PIP ${pipId} not found`);
    }

    pip.finalSuccessRate = finalMetrics.successRate;
    pip.finalCostEfficiency = finalMetrics.costEfficiency;

    // Determine outcome — only set completedAt when truly done
    if (finalMetrics.successRate >= pip.targetSuccessRate) {
      pip.outcome = "promoted";
      pip.status = "completed";
      pip.completedAt = new Date();
    } else if (pip.upskillingAttempts < PIP_CONFIGURATION.maxUpskillingAttempts) {
      pip.outcome = "extended";
      pip.status = "active"; // Extended, not completed — do not set completedAt
    } else {
      pip.outcome = "terminated";
      pip.status = "failed";
      pip.completedAt = new Date();
    }

    this.store.setPip(pip);

    // Update agent status
    const perf = this.store.getPerformance(pip.agentId, pip.organizationId);
    if (perf) {
      if (pip.outcome === "promoted") {
        perf.status = "active";
      } else if (pip.outcome === "terminated") {
        perf.status = "deprovisioned";
      }
      this.store.setPerformance(perf);
    }

    logger.info(`Completed PIP ${pipId} with outcome: ${pip.outcome}`, {
      finalSuccessRate: finalMetrics.successRate,
      target: pip.targetSuccessRate,
    });

    eventStream.publish(
      "agent.pip_completed",
      {
        pipId,
        agentId: pip.agentId,
        outcome: pip.outcome,
        finalSuccessRate: finalMetrics.successRate,
      },
      { organizationId: pip.organizationId },
      "performance_manager"
    );

    return pip;
  }

  /**
   * Initiate autonomous upskilling
   */
  async initiateUpskilling(
    agentId: string,
    organizationId: number,
    pipId: string,
    type: "fine_tuning" | "golden_samples" | "prompt_optimization"
  ): Promise<UpskillingJob> {
    const pip = this.store.getPip(pipId);
    if (!pip) {
      throw new Error(`PIP ${pipId} not found`);
    }

    const id = `upskill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const job: UpskillingJob = {
      id,
      agentId,
      pipId,
      status: "queued",
      type,
      progressPercent: 0,
    };

    this.store.setUpskilling(job);

    pip.upskillingAttempts++;
    this.store.setPip(pip);

    logger.info(`Initiated ${type} upskilling for agent ${agentId}`, {
      jobId: id,
      pipId,
      attempt: pip.upskillingAttempts,
    });

    // Publish event
    eventStream.publish(
      "agent.upskilling_initiated",
      {
        jobId: id,
        agentId,
        pipId,
        type,
        attempt: pip.upskillingAttempts,
      },
      { organizationId },
      "performance_manager"
    );

    // Execute autonomous upskilling workflow via Upskilling Orchestrator asynchronously
    setImmediate(() => {
      upskillingOrchestratorService.executeUpskilling(job, organizationId).catch((err) => {
        logger.error(`Upskilling execution failed for job ${job.id}: ${err.message}`, err);
      });
    });

    return job;
  }

  /**
   * Get performance summary for dashboard
   */
  async getPerformanceSummary(organizationId: number): Promise<{
    totalAgents: number;
    active: number;
    onProbation: number;
    inPIP: number;
    deprovisioned: number;
    avgEfficiency: number;
    trend: "improving" | "declining" | "stable";
    topPerformers: AgentPerformance[];
    atRiskAgents: AgentPerformance[];
  }> {
    const performances = this.store.getAllPerformances(organizationId);

    const active = performances.filter((p) => p.status === "active").length;
    const onProbation = performances.filter((p) => p.status === "probation").length;
    const inPIP = performances.filter((p) => p.status === "pip").length;
    const deprovisioned = performances.filter((p) => p.status === "deprovisioned").length;

    const avgEfficiency =
      performances.length > 0
        ? performances.reduce((sum, p) => sum + p.efficiencyScore, 0) / performances.length
        : 0;

    // Calculate trend
    const improving = performances.filter((p) => p.trend === "improving").length;
    const declining = performances.filter((p) => p.trend === "declining").length;
    let trend: "improving" | "declining" | "stable" = "stable";
    if (improving > declining) trend = "improving";
    else if (declining > improving) trend = "declining";

    // Sort by efficiency for top performers and at risk
    const sorted = [...performances].sort((a, b) => b.efficiencyScore - a.efficiencyScore);

    return {
      totalAgents: performances.length,
      active,
      onProbation,
      inPIP,
      deprovisioned,
      avgEfficiency: Math.round(avgEfficiency * 100) / 100,
      trend,
      topPerformers: sorted.slice(0, 5),
      atRiskAgents: sorted.slice(-5).filter((p) => p.efficiencyScore < 0.5),
    };
  }

  /**
   * Get all PIPs for an organization
   */
  getActivePIP(agentId: string, organizationId: number): PerformanceImprovementPlan | undefined {
    return this.store.getActivePip(agentId, organizationId);
  }

  getAgentPIPs(agentId: string, organizationId: number): PerformanceImprovementPlan[] {
    return this.store.getPipsForAgent(agentId, organizationId);
  }

  getAgentPerformance(agentId: string, organizationId: number): AgentPerformance | undefined {
    return this.store.getPerformance(agentId, organizationId);
  }

  async getOrganizationPIPs(
    organizationId: number,
    status?: PerformanceImprovementPlan["status"]
  ): Promise<PerformanceImprovementPlan[]> {
    const pips = this.store.getAllPipsForOrg(organizationId);

    if (status) {
      return pips.filter((p) => p.status === status);
    }

    return pips;
  }

  /**
   * Daily evaluation job - should be called by scheduler
   */
  async runDailyEvaluation(organizationId: number): Promise<{
    evaluated: number;
    warnings: number;
    pipsCreated: number;
    pipsCompleted: number;
    upskillingInitiated: number;
  }> {
    const results = {
      evaluated: 0,
      warnings: 0,
      pipsCreated: 0,
      pipsCompleted: 0,
      upskillingInitiated: 0,
    };

    const performances = this.store.getAllPerformances(organizationId);

    for (const perf of performances) {
      // Skip recently evaluated
      const hoursSinceEval =
        (Date.now() - perf.lastEvaluatedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceEval < 24) continue;

      results.evaluated++;

      // Check if PIP should be completed
      if (perf.status === "pip") {
        const pip = this.store.getActivePip(perf.agentId, organizationId);
        if (pip && pip.startedAt) {
          const daysActive = (Date.now() - pip.startedAt.getTime()) / (1000 * 60 * 60 * 24);

          if (daysActive >= pip.deadlineDays) {
            await this.completePIP(pip.id, {
              successRate: perf.successRate,
              costEfficiency: perf.costPerSuccess,
            });
            results.pipsCompleted++;
            continue;
          }
        }
      }

      // Determine action
      const action = this.determineAction(perf, perf.status);

      if (action.actionRequired === "pip" && perf.status !== "pip") {
        await this.createPIP(
          perf.agentId,
          organizationId,
          action.reasons[0],
          "below_threshold"
        );
        results.pipsCreated++;
      } else if (action.actionRequired === "warn") {
        results.warnings++;
      }
    }

    logger.info(`Daily evaluation complete for org ${organizationId}`, results);

    return results;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private filterRecentMissions<T extends { timestamp: Date }>(
    missions: T[],
    days: number
  ): T[] {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return missions.filter((m) => m.timestamp >= cutoff);
  }

  private determineAction(
    perf: AgentPerformance,
    currentStatus: string
  ): EvaluationResult {
    const reasons: string[] = [];
    let actionRequired: "none" | "warn" | "pip" | "terminate" = "none";
    let newStatus = currentStatus;

    // Check reliability threshold
    if (perf.successRate < this.thresholds.reliabilityMin) {
      reasons.push(
        `Success rate ${Math.round(perf.successRate * 100)}% below threshold ${Math.round(
          this.thresholds.reliabilityMin * 100
        )}%`
      );
    }

    // Check cost efficiency
    if (perf.costPerSuccess > this.thresholds.costEfficiencyMax) {
      reasons.push(
        `Cost per success ${Math.round(perf.costPerSuccess)} exceeds threshold ${this.thresholds.costEfficiencyMax}`
      );
    }

    // Determine action based on current status and performance
    if (currentStatus === "active") {
      if (reasons.length > 0) {
        if (perf.efficiencyScore < 0.4) {
          actionRequired = "pip";
          newStatus = "pip";
        } else {
          actionRequired = "warn";
          newStatus = "probation";
        }
      }
    } else if (currentStatus === "probation") {
      if (reasons.length > 0 && perf.trend === "declining") {
        actionRequired = "pip";
        newStatus = "pip";
      } else if (reasons.length === 0 && perf.trend === "improving") {
        actionRequired = "none";
        newStatus = "active";
      } else {
        actionRequired = "warn";
      }
    } else if (currentStatus === "pip") {
      // PIP status is managed separately via completePIP
      actionRequired = "none";
    }

    return {
      agentId: perf.agentId,
      previousStatus: currentStatus,
      newStatus,
      actionRequired,
      reasons,
      metrics: {
        successRate: perf.successRate,
        costPerSuccess: perf.costPerSuccess,
        efficiencyScore: perf.efficiencyScore,
      },
    };
  }

  private simulateUpskillingProgress(job: UpskillingJob): void {
    // Simulate async upskilling process
    setTimeout(() => {
      job.status = "training";
      job.progressPercent = 25;
      job.startedAt = new Date();
      this.store.setUpskilling(job);

      // Simulate completion after 5 seconds (in real impl, this would be hours/days)
      setTimeout(() => {
        job.status = Math.random() > 0.2 ? "completed" : "failed"; // 80% success
        job.progressPercent = 100;
        job.completedAt = new Date();
        this.store.setUpskilling(job);

        logger.info(`Upskilling job ${job.id} ${job.status}`);

        eventStream.publish(
          "agent.upskilling_completed",
          {
            jobId: job.id,
            agentId: job.agentId,
            pipId: job.pipId,
            status: job.status,
            type: job.type,
          },
          {},
          "performance_manager"
        );
      }, 5000);
    }, 1000);
  }
}

// ============================================================================
// SERVICE INSTANCE
// ============================================================================

export const performanceManagerService = new PerformanceManagerService();

// Hydrate store from DB at startup
import("@server/database_service.js").then(({ db }) => {
  (performanceManagerService as any).store.initialize(db).catch((err: any) =>
    logger.warn("PerformanceStore DB init failed — using in-memory fallback:", err)
  );
}).catch(() => {});
