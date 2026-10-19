import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@server/domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("Governance");

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Budget policy for an organization or department
 */
export interface BudgetPolicy {
  id: string;
  organizationId: number;
  department?: string;
  monthlyLimit: number; // Token limit per month
  alertThreshold: number; // Percentage (0-1) when to alert
  hardLimit: number; // Absolute maximum tokens allowed
  currency: "tokens" | "usd" | "credits";
  resetDay: number; // Day of month when budget resets (1-31)
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Agent salary allocation
 */
export interface AgentSalary {
  id: string;
  agentId: string;
  organizationId: number;
  sessionId?: string;
  tokenAllowance: number; // Monthly allowance
  currentSpend: number; // Current month spend
  lifetimeSpend: number; // All-time spend
  efficiencyScore: number; // Success rate * cost efficiency (0-1)
  lastEvaluationAt: Date;
  createdAt: Date;
}

/**
 * Budget check result
 */
export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remainingBudget: number;
  projectedCost: number;
  wouldExceedLimit: boolean;
  alertLevel: "none" | "warning" | "critical";
  requiresApproval: boolean;
  approvalType?: "manager" | "board" | "auto";
}

/**
 * Approval request for high-cost/risk operations
 */
export interface ApprovalRequest {
  id: string;
  organizationId: number;
  type: "budget_exceeded" | "high_risk_manifest" | "cost_spike";
  requesterId: string; // Agent or user requesting
  missionId?: number;
  manifestId?: string;
  projectedCost: number;
  currentSpend: number;
  budgetLimit: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  description: string;
  status: "pending" | "approved" | "rejected" | "auto_approved";
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  requiredBy?: Date;
}

/**
 * Cost analytics for ROI tracking
 */
export interface CostAnalytics {
  organizationId: number;
  period: { start: Date; end: Date };
  totalSpend: number;
  successfulSpend: number; // Cost of successful operations
  failedSpend: number; // Wasted cost on failures
  efficiency: number; // successful / total (0-1)
  costPerSuccess: number;
  projectedMonthly: number; // Based on current rate
  budgetUtilization: number; // Current / limit (0-1)
  topSpenders: Array<{
    agentId: string;
    spend: number;
    successRate: number;
    efficiency: number;
  }>;
  costTrend: "increasing" | "decreasing" | "stable";
}

/**
 * Governance event types
 */
export type GovernanceEvent =
  | { type: "budget.exceeded"; payload: { organizationId: number; agentId: string; attempted: number; limit: number } }
  | { type: "budget.warning"; payload: { organizationId: number; utilization: number; threshold: number } }
  | { type: "approval.requested"; payload: { requestId: string; type: string; projectedCost: number } }
  | { type: "approval.resolved"; payload: { requestId: string; status: string; approvedBy?: string } }
  | { type: "salary.adjusted"; payload: { agentId: string; oldAllowance: number; newAllowance: number; reason: string } }
  | { type: "cost.spike"; payload: { organizationId: number; agentId: string; spikeAmount: number; threshold: number } };

// ============================================================================
// IN-MEMORY STORE (Production: Database)
// ============================================================================

// Write-through: reads from in-memory Maps (fast), writes to DB for durability.
// Call initialize(db) at startup to hydrate Maps from DB.
class GovernanceStore {
  private budgets = new Map<string, BudgetPolicy>();
  private salaries = new Map<string, AgentSalary>();
  private approvals = new Map<string, ApprovalRequest>();
  private spendHistory = new Map<string, Array<{ timestamp: Date; amount: number; success: boolean }>>();
  private db: any = null;

  async initialize(db: any): Promise<void> {
    this.db = db;
    const { governanceBudgetPolicies, governanceAgentSalaries, governanceApprovals } =
      await import("@shared/schema/governance-ops.js");

    const [dbBudgets, dbSalaries, dbApprovals] = await Promise.all([
      db.select().from(governanceBudgetPolicies),
      db.select().from(governanceAgentSalaries),
      db.select().from(governanceApprovals),
    ]);

    for (const b of dbBudgets) {
      this.budgets.set(b.id, { id: b.id, organizationId: b.organizationId,
        department: b.department ?? undefined, monthlyLimit: b.monthlyLimit,
        alertThreshold: parseFloat(String(b.alertThreshold)), hardLimit: b.hardLimit,
        currency: b.currency as any, resetDay: b.resetDay,
        createdAt: b.createdAt, updatedAt: b.updatedAt });
    }
    for (const s of dbSalaries) {
      this.salaries.set(s.id, { id: s.id, agentId: s.agentId, organizationId: s.organizationId,
        tokenAllowance: s.tokenAllowance, currentSpend: s.currentSpend,
        lifetimeSpend: s.lifetimeSpend, efficiencyScore: parseFloat(String(s.efficiencyScore)),
        lastEvaluationAt: s.lastEvaluationAt, createdAt: s.createdAt });
    }
    for (const a of dbApprovals) {
      this.approvals.set(a.id, { id: a.id, organizationId: a.organizationId, type: a.type as any,
        requesterId: a.requesterId, missionId: a.missionId ?? undefined,
        manifestId: a.manifestId ?? undefined, projectedCost: a.projectedCost,
        currentSpend: a.currentSpend, budgetLimit: a.budgetLimit, riskLevel: a.riskLevel as any,
        description: a.description, status: a.status as any,
        approvedBy: a.approvedBy ?? undefined, approvedAt: a.approvedAt ?? undefined,
        rejectionReason: a.rejectionReason ?? undefined, requiredBy: a.requiredBy ?? undefined,
        createdAt: a.createdAt });
    }
    logger.info(`GovernanceStore loaded: ${dbBudgets.length} budgets, ${dbSalaries.length} salaries, ${dbApprovals.length} approvals`);
  }

  private async persistBudget(b: BudgetPolicy): Promise<void> {
    if (!this.db) return;
    try {
      const { governanceBudgetPolicies: t } = await import("@shared/schema/governance-ops.js");
      await this.db.insert(t).values({ id: b.id, organizationId: b.organizationId,
        department: b.department, monthlyLimit: b.monthlyLimit,
        alertThreshold: String(b.alertThreshold), hardLimit: b.hardLimit,
        currency: b.currency, resetDay: b.resetDay })
        .onConflictDoUpdate({ target: t.id, set: { monthlyLimit: b.monthlyLimit,
          alertThreshold: String(b.alertThreshold), hardLimit: b.hardLimit,
          department: b.department, updatedAt: new Date() } });
    } catch (err) { logger.error("GovernanceStore: failed to persist budget", err); }
  }

  private async persistSalary(s: AgentSalary): Promise<void> {
    if (!this.db) return;
    try {
      const { governanceAgentSalaries: t } = await import("@shared/schema/governance-ops.js");
      await this.db.insert(t).values({ id: s.id, agentId: s.agentId, organizationId: s.organizationId,
        tokenAllowance: s.tokenAllowance, currentSpend: s.currentSpend,
        lifetimeSpend: s.lifetimeSpend, efficiencyScore: String(s.efficiencyScore),
        lastEvaluationAt: s.lastEvaluationAt })
        .onConflictDoUpdate({ target: [t.agentId, t.organizationId], set: {
          tokenAllowance: s.tokenAllowance, currentSpend: s.currentSpend,
          lifetimeSpend: s.lifetimeSpend, efficiencyScore: String(s.efficiencyScore),
          lastEvaluationAt: s.lastEvaluationAt, updatedAt: new Date() } });
    } catch (err) { logger.error("GovernanceStore: failed to persist salary", err); }
  }

  private async persistApproval(a: ApprovalRequest): Promise<void> {
    if (!this.db) return;
    try {
      const { governanceApprovals: t } = await import("@shared/schema/governance-ops.js");
      await this.db.insert(t).values({ id: a.id, organizationId: a.organizationId, type: a.type,
        requesterId: a.requesterId, missionId: a.missionId, projectedCost: a.projectedCost,
        currentSpend: a.currentSpend, budgetLimit: a.budgetLimit, riskLevel: a.riskLevel,
        description: a.description, status: a.status, approvedBy: a.approvedBy,
        approvedAt: a.approvedAt, rejectionReason: a.rejectionReason, requiredBy: a.requiredBy })
        .onConflictDoUpdate({ target: t.id, set: { status: a.status, approvedBy: a.approvedBy,
          approvedAt: a.approvedAt, rejectionReason: a.rejectionReason } });
    } catch (err) { logger.error("GovernanceStore: failed to persist approval", err); }
  }

  private async persistSpendEvent(agentId: string, organizationId: number, amount: number, success: boolean): Promise<void> {
    if (!this.db) return;
    try {
      const { agentSpendEvents: t } = await import("@shared/schema/governance-ops.js");
      await this.db.insert(t).values({ agentId, organizationId, amount, success });
    } catch (err) { logger.error("GovernanceStore: failed to persist spend event", err); }
  }

  setBudget(budget: BudgetPolicy): void {
    this.budgets.set(budget.id, budget);
    this.persistBudget(budget).catch(() => {});
  }

  getBudget(id: string): BudgetPolicy | undefined { return this.budgets.get(id); }

  getBudgetsForOrg(organizationId: number): BudgetPolicy[] {
    return Array.from(this.budgets.values()).filter((b) => b.organizationId === organizationId);
  }

  setSalary(salary: AgentSalary): void {
    this.salaries.set(salary.id, salary);
    this.persistSalary(salary).catch(() => {});
  }

  getSalary(id: string): AgentSalary | undefined { return this.salaries.get(id); }

  getSalaryForAgent(agentId: string, organizationId: number): AgentSalary | undefined {
    return Array.from(this.salaries.values()).find(
      (s) => s.agentId === agentId && s.organizationId === organizationId
    );
  }

  getSalariesForOrg(organizationId: number): AgentSalary[] {
    return Array.from(this.salaries.values()).filter((s) => s.organizationId === organizationId);
  }

  addApproval(approval: ApprovalRequest): void {
    this.approvals.set(approval.id, approval);
    this.persistApproval(approval).catch(() => {});
  }

  getApproval(id: string): ApprovalRequest | undefined { return this.approvals.get(id); }

  getPendingApprovals(organizationId: number): ApprovalRequest[] {
    return Array.from(this.approvals.values()).filter(
      (a) => a.organizationId === organizationId && a.status === "pending"
    );
  }

  updateApproval(approval: ApprovalRequest): void {
    this.approvals.set(approval.id, approval);
    this.persistApproval(approval).catch(() => {});
  }

  recordSpend(agentId: string, amount: number, success: boolean, organizationId = 0): void {
    if (!this.spendHistory.has(agentId)) this.spendHistory.set(agentId, []);
    const history = this.spendHistory.get(agentId)!;
    history.push({ timestamp: new Date(), amount, success });
    // Keep last 90 days in memory
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    this.spendHistory.set(agentId, history.filter(h => h.timestamp >= cutoff));
    if (organizationId > 0) {
      this.persistSpendEvent(agentId, organizationId, amount, success).catch(() => {});
    }
  }

  getSpendHistory(agentId: string): Array<{ timestamp: Date; amount: number; success: boolean }> {
    return this.spendHistory.get(agentId) || [];
  }

  clear(): void {
    this.budgets.clear();
    this.salaries.clear();
    this.approvals.clear();
    this.spendHistory.clear();
  }
}

// ============================================================================
// MAIN SERVICE
// ============================================================================

/**
 * GovernanceService
 *
 * Manages enterprise-grade governance including:
 * - Budget policies and enforcement
 * - Agent token salaries
 * - Board approval gates
 * - Cost analytics and ROI tracking
 */
export class GovernanceService {
  private store = new GovernanceStore();

  /**
   * Create or update a budget policy
   */
  async setBudgetPolicy(policy: Omit<BudgetPolicy, "id" | "createdAt" | "updatedAt">): Promise<BudgetPolicy> {
    const id = `budget-${policy.organizationId}-${policy.department || "default"}`;

    const budget: BudgetPolicy = {
      ...policy,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.store.setBudget(budget);

    logger.info(`Set budget policy for org ${policy.organizationId}`, {
      monthlyLimit: policy.monthlyLimit,
      department: policy.department,
    });

    // Publish event
    eventStream.publish(
      "governance.budget_set",
      {
        organizationId: policy.organizationId,
        monthlyLimit: policy.monthlyLimit,
      },
      { organizationId: policy.organizationId },
      "governance"
    );

    return budget;
  }

  /**
   * Get budget policy for organization
   */
  async getBudgetPolicy(organizationId: number, department?: string): Promise<BudgetPolicy | undefined> {
    const budgets = this.store.getBudgetsForOrg(organizationId);
    return budgets.find((b) => b.department === (department || undefined)) || budgets[0];
  }

  /**
   * Set agent salary (token allowance)
   */
  async setAgentSalary(
    agentId: string,
    organizationId: number,
    tokenAllowance: number,
    sessionId?: string
  ): Promise<AgentSalary> {
    const id = `salary-${agentId}-${sessionId || "default"}`;

    const existing = this.store.getSalary(id);

    const salary: AgentSalary = {
      id,
      agentId,
      organizationId,
      sessionId,
      tokenAllowance,
      currentSpend: existing?.currentSpend || 0,
      lifetimeSpend: existing?.lifetimeSpend || 0,
      efficiencyScore: existing?.efficiencyScore || 1.0,
      lastEvaluationAt: new Date(),
      createdAt: existing?.createdAt || new Date(),
    };

    this.store.setSalary(salary);

    logger.info(`Set salary for agent ${agentId}`, { tokenAllowance });

    return salary;
  }

  /**
   * Check if an operation is within budget
   */
  async checkBudget(
    agentId: string,
    organizationId: number,
    estimatedTokens: number,
    options: {
      riskLevel?: "low" | "medium" | "high" | "critical";
      missionId?: number;
      manifestId?: string;
    } = {}
  ): Promise<BudgetCheckResult> {
    const { riskLevel = "low" } = options;

    // Get salary record
    const salary = this.store.getSalaryForAgent(agentId, organizationId);
    if (!salary) {
      return {
        allowed: false,
        reason: "No salary allocation found for agent",
        remainingBudget: 0,
        projectedCost: estimatedTokens,
        wouldExceedLimit: true,
        alertLevel: "critical",
        requiresApproval: true,
        approvalType: "board",
      };
    }

    // Get budget policy
    const budget = await this.getBudgetPolicy(organizationId);
    if (!budget) {
      return {
        allowed: false,
        reason: "No budget policy configured",
        remainingBudget: 0,
        projectedCost: estimatedTokens,
        wouldExceedLimit: true,
        alertLevel: "critical",
        requiresApproval: true,
        approvalType: "board",
      };
    }

    // Calculate remaining budget
    const remainingBudget = salary.tokenAllowance - salary.currentSpend;
    const projectedSpend = salary.currentSpend + estimatedTokens;
    const utilization = salary.currentSpend / salary.tokenAllowance;

    // Check if this operation would exceed limits
    const wouldExceedSalary = projectedSpend > salary.tokenAllowance;
    const wouldExceedHardLimit = projectedSpend > budget.hardLimit;

    // Determine alert level
    let alertLevel: "none" | "warning" | "critical" = "none";
    if (utilization >= budget.alertThreshold) {
      alertLevel = utilization >= 0.9 ? "critical" : "warning";
    }

    // Determine if approval required
    let requiresApproval = false;
    let approvalType: "manager" | "board" | "auto" = "auto";

    if (wouldExceedSalary || wouldExceedHardLimit) {
      requiresApproval = true;
      approvalType = riskLevel === "critical" || riskLevel === "high" ? "board" : "manager";
    } else if (riskLevel === "high" || riskLevel === "critical") {
      requiresApproval = true;
      approvalType = "board";
    }

    // Check for cost spikes — compare last 24h to the 7-day rolling average.
    // Using currentSpend/30 (30-day average) is unreliable for new agents where
    // currentSpend is 0, making avgDailySpend = 0 and triggering on the first token.
    const recentSpend = this.getRecentSpend(agentId, 24); // Last 24 hours
    const sevenDaySpend = this.getRecentSpend(agentId, 168); // Last 7 days
    const avgDailySpend = sevenDaySpend / 7;
    if (avgDailySpend > 0 && recentSpend > avgDailySpend * 3) {
      // 3x normal daily spend
      requiresApproval = true;
      approvalType = "manager";

      // Emit cost spike event
      eventStream.publish(
        "governance.cost_spike",
        {
          organizationId,
          agentId,
          recentSpend,
          threshold: avgDailySpend * 3,
        },
        { organizationId },
        "governance"
      );
    }

    const result: BudgetCheckResult = {
      allowed: !requiresApproval,
      remainingBudget,
      projectedCost: estimatedTokens,
      wouldExceedLimit: wouldExceedSalary || wouldExceedHardLimit,
      alertLevel,
      requiresApproval,
      approvalType,
    };

    if (!result.allowed) {
      result.reason = wouldExceedSalary
        ? `Would exceed agent salary limit (${salary.tokenAllowance} tokens)`
        : wouldExceedHardLimit
          ? `Would exceed hard limit (${budget.hardLimit} tokens)`
          : "High-risk operation requires approval";
    }

    logger.debug(`Budget check for agent ${agentId}`, result);

    return result;
  }

  /**
   * Record actual spend after operation
   */
  async recordSpend(
    agentId: string,
    organizationId: number,
    actualTokens: number,
    success: boolean
  ): Promise<void> {
    const salary = this.store.getSalaryForAgent(agentId, organizationId);
    if (!salary) {
      logger.warn(`Cannot record spend - no salary found for agent ${agentId}`);
      return;
    }

    // Update salary record
    salary.currentSpend += actualTokens;
    salary.lifetimeSpend += actualTokens;

    // Record in history
    this.store.recordSpend(agentId, actualTokens, success);

    // Update efficiency score
    const history = this.store.getSpendHistory(agentId);
    const recentHistory = history.slice(-20); // Last 20 operations
    const successRate = recentHistory.filter((h) => h.success).length / recentHistory.length;
    const costEfficiency = successRate * (1 - Math.min(salary.currentSpend / salary.tokenAllowance, 1));
    salary.efficiencyScore = costEfficiency;
    salary.lastEvaluationAt = new Date();

    this.store.setSalary(salary);

    // Check thresholds and emit events
    const utilization = salary.currentSpend / salary.tokenAllowance;
    const budget = await this.getBudgetPolicy(organizationId);

    if (budget && utilization >= budget.alertThreshold) {
      eventStream.publish(
        "governance.budget_warning",
        {
          organizationId,
          agentId,
          utilization: Math.round(utilization * 100),
          threshold: Math.round(budget.alertThreshold * 100),
        },
        { organizationId },
        "governance"
      );
    }

    if (salary.currentSpend >= salary.tokenAllowance) {
      eventStream.publish(
        "governance.budget_exceeded",
        {
          organizationId,
          agentId,
          currentSpend: salary.currentSpend,
          allowance: salary.tokenAllowance,
        },
        { organizationId },
        "governance"
      );
    }

    logger.info(`Recorded spend for agent ${agentId}`, {
      actualTokens,
      currentSpend: salary.currentSpend,
      success,
    });
  }

  /**
   * Create approval request for high-cost/risk operation
   */
  async createApprovalRequest(
    request: Omit<ApprovalRequest, "id" | "createdAt" | "status">
  ): Promise<ApprovalRequest> {
    const id = `approval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const approval: ApprovalRequest = {
      ...request,
      id,
      status: "pending",
      createdAt: new Date(),
    };

    this.store.addApproval(approval);

    logger.info(`Created approval request ${id}`, {
      type: request.type,
      projectedCost: request.projectedCost,
      riskLevel: request.riskLevel,
    });

    // Publish event
    eventStream.publish(
      "governance.approval_requested",
      {
        requestId: id,
        type: request.type,
        projectedCost: request.projectedCost,
        riskLevel: request.riskLevel,
        organizationId: request.organizationId,
      },
      { organizationId: request.organizationId },
      "governance"
    );

    return approval;
  }

  /**
   * Resolve an approval request
   */
  async resolveApproval(
    requestId: string,
    decision: "approved" | "rejected",
    approverId: string,
    rejectionReason?: string
  ): Promise<ApprovalRequest> {
    const approval = this.store.getApproval(requestId);
    if (!approval) {
      throw new Error(`Approval request ${requestId} not found`);
    }

    if (approval.status !== "pending") {
      throw new Error(`Approval request ${requestId} is already ${approval.status}`);
    }

    approval.status = decision;
    approval.approvedBy = approverId;
    approval.approvedAt = new Date();
    if (decision === "rejected") {
      approval.rejectionReason = rejectionReason;
    }

    this.store.addApproval(approval);

    logger.info(`Approval ${requestId} ${decision} by ${approverId}`);

    // Publish event
    eventStream.publish(
      "governance.approval_resolved",
      {
        requestId,
        status: decision,
        approvedBy: approverId,
        organizationId: approval.organizationId,
      },
      { organizationId: approval.organizationId },
      "governance"
    );

    return approval;
  }

  /**
   * Get pending approval requests
   */
  async getPendingApprovals(organizationId: number): Promise<ApprovalRequest[]> {
    return this.store.getPendingApprovals(organizationId);
  }

  /**
   * Get cost analytics for organization
   */
  async getCostAnalytics(
    organizationId: number,
    period: { start: Date; end: Date }
  ): Promise<CostAnalytics> {
    const salaries = this.store.getSalariesForOrg(organizationId);

    let totalSpend = 0;
    let successfulSpend = 0;
    let failedSpend = 0;

    const topSpenders: CostAnalytics["topSpenders"] = [];

    for (const salary of salaries) {
      const history = this.store.getSpendHistory(salary.agentId);
      const periodHistory = history.filter(
        (h) => h.timestamp >= period.start && h.timestamp <= period.end
      );

      const agentTotal = periodHistory.reduce((sum, h) => sum + h.amount, 0);
      const agentSuccess = periodHistory.filter((h) => h.success).reduce((sum, h) => sum + h.amount, 0);
      const agentFailed = agentTotal - agentSuccess;

      totalSpend += agentTotal;
      successfulSpend += agentSuccess;
      failedSpend += agentFailed;

      const successRate = periodHistory.length > 0
        ? periodHistory.filter((h) => h.success).length / periodHistory.length
        : 0;

      topSpenders.push({
        agentId: salary.agentId,
        spend: agentTotal,
        successRate,
        efficiency: salary.efficiencyScore,
      });
    }

    // Sort by spend descending
    topSpenders.sort((a, b) => b.spend - a.spend);

    const efficiency = totalSpend > 0 ? successfulSpend / totalSpend : 0;
    const costPerSuccess = successfulSpend > 0 ? totalSpend / (successfulSpend / 1000) : 0; // Per 1000 tokens

    // Calculate trend
    const days = (period.end.getTime() - period.start.getTime()) / (1000 * 60 * 60 * 24);
    const dailyRate = totalSpend / days;
    const projectedMonthly = dailyRate * 30;

    const budget = await this.getBudgetPolicy(organizationId);
    const budgetUtilization = budget ? totalSpend / budget.monthlyLimit : 0;

    // Simple trend detection
    const recentHistory = salaries.flatMap((s) =>
      this.store.getSpendHistory(s.agentId).filter((h) => h.timestamp >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
    );
    const olderHistory = salaries.flatMap((s) =>
      this.store.getSpendHistory(s.agentId).filter((h) => {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        return h.timestamp >= twoWeeksAgo && h.timestamp < weekAgo;
      })
    );

    const recentAvg = recentHistory.reduce((sum, h) => sum + h.amount, 0) / 7;
    const olderAvg = olderHistory.reduce((sum, h) => sum + h.amount, 0) / 7;

    let costTrend: "increasing" | "decreasing" | "stable" = "stable";
    if (recentAvg > olderAvg * 1.2) costTrend = "increasing";
    else if (recentAvg < olderAvg * 0.8) costTrend = "decreasing";

    return {
      organizationId,
      period,
      totalSpend,
      successfulSpend,
      failedSpend,
      efficiency,
      costPerSuccess,
      projectedMonthly,
      budgetUtilization,
      topSpenders: topSpenders.slice(0, 10),
      costTrend,
    };
  }

  /**
   * Adjust agent salary based on performance
   */
  async adjustSalary(
    agentId: string,
    organizationId: number,
    newAllowance: number,
    reason: string
  ): Promise<AgentSalary> {
    const salary = this.store.getSalaryForAgent(agentId, organizationId);
    if (!salary) {
      throw new Error(`No salary found for agent ${agentId}`);
    }

    const oldAllowance = salary.tokenAllowance;
    salary.tokenAllowance = newAllowance;

    this.store.setSalary(salary);

    logger.info(`Adjusted salary for agent ${agentId}`, {
      oldAllowance,
      newAllowance,
      reason,
    });

    // Publish event
    eventStream.publish(
      "governance.salary_adjusted",
      {
        agentId,
        oldAllowance,
        newAllowance,
        reason,
        organizationId,
      },
      { organizationId },
      "governance"
    );

    return salary;
  }

  /**
   * Reset monthly spend counters
   */
  async resetMonthlySpend(organizationId: number): Promise<void> {
    const salaries = this.store.getSalariesForOrg(organizationId);

    for (const salary of salaries) {
      salary.currentSpend = 0;
      salary.lastEvaluationAt = new Date();
      this.store.setSalary(salary);
    }

    logger.info(`Reset monthly spend for org ${organizationId}`, {
      agentsReset: salaries.length,
    });
  }

  /**
   * Get all budgets for organization
   */
  async getBudgets(organizationId: number): Promise<BudgetPolicy[]> {
    return this.store.getBudgetsForOrg(organizationId);
  }

  /**
   * Get all salaries for organization
   */
  async getSalaries(organizationId: number): Promise<AgentSalary[]> {
    return this.store.getSalariesForOrg(organizationId);
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private getRecentSpend(agentId: string, hours: number): number {
    const history = this.store.getSpendHistory(agentId);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    return history.filter((h) => h.timestamp >= cutoff).reduce((sum, h) => sum + h.amount, 0);
  }
}

// ============================================================================
// SERVICE INSTANCE
// ============================================================================

export const governanceService = new GovernanceService();

// Hydrate store from DB at startup
import("@server/database_service.js").then(({ db }) => {
  (governanceService as any).store.initialize(db).catch((err: any) =>
    logger.warn("GovernanceStore DB init failed — using in-memory fallback:", err)
  );
}).catch(() => {});
