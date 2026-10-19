/**
 * Cost Tracking & Billing Service
 *
 * Sources real cost data from aiTokenUsage / aiTokenDailyAggregation tables
 * written by tokenTrackingService during every AI call. Budget alerts are
 * persisted in the governanceAgentSalaries / governanceBudgetPolicies tables.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { db } from '@server/database_service.js';
import {
  aiTokenUsage,
  aiTokenDailyAggregation,
} from '@shared/schema/index.js';
import { governanceBudgetPolicies } from '@shared/schema/governance-ops.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import type {
  AgentCostMetrics,
  BillingRecord,
  BudgetAlert,
  CostOptimizationRecommendation,
  CreateBudgetAlertRequest,
} from '../../../shared/schema/compliance.js';

const logger = createLogger('CostTrackingService');

export class CostTrackingService extends EventEmitter {
  // Budget alerts are kept in-memory only (they're ephemeral notification state).
  // The underlying budget policies live in governanceBudgetPolicies.
  private budgetAlerts: Map<string, BudgetAlert> = new Map();
  private recommendations: Map<string, CostOptimizationRecommendation> = new Map();

  // ─── Usage recording ──────────────────────────────────────────────────────

  /**
   * Record a usage event.
   * Delegates to tokenTrackingService which writes to aiTokenUsage / daily agg.
   */
  async recordUsage(event: {
    agentId: string;
    organizationId: string;
    timestamp: Date;
    type: 'request' | 'tokens' | 'compute' | 'storage';
    quantity: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    if (event.type === 'tokens') {
      const { tokenTrackingService } = await import(
        '../jobs/core/token-tracking.service.js'
      );
      await tokenTrackingService.recordUsage({
        jobId: parseInt(event.agentId) || 0,
        organizationId: parseInt(event.organizationId) || undefined,
        modelProvider: event.metadata?.provider || 'unknown',
        modelName: event.metadata?.model || 'default',
        inputTokens: event.metadata?.promptTokens || 0,
        outputTokens: event.metadata?.completionTokens || Math.floor(event.quantity),
        latencyMs: event.metadata?.latencyMs,
        promptType: event.metadata?.promptType,
        promptCategory: event.metadata?.promptCategory,
        metadata: event.metadata,
      });
    }
    // compute / storage / request events are not currently tracked in the DB
    await this.checkBudgetThresholds(event.organizationId);
    this.emit('usage:recorded', event);
  }

  // ─── Cost queries ─────────────────────────────────────────────────────────

  /**
   * Return per-period cost metrics for a specific job/agent.
   * Reads from aiTokenUsage for the requested window.
   */
  async getAgentCostMetrics(
    agentId: string,
    period?: { start: string; end: string },
    _organizationId?: string
  ): Promise<AgentCostMetrics[]> {
    const jobId = parseInt(agentId);
    if (isNaN(jobId)) return [];

    const conditions: any[] = [eq(aiTokenUsage.jobId, jobId)];
    if (period) {
      conditions.push(gte(aiTokenUsage.requestTimestamp, new Date(period.start)));
      conditions.push(lte(aiTokenUsage.requestTimestamp, new Date(period.end)));
    }

    const rows = await db
      .select()
      .from(aiTokenUsage)
      .where(and(...conditions))
      .limit(500);

    if (rows.length === 0) return [];

    // Group into daily buckets
    const byDay: Record<string, typeof rows> = {};
    for (const row of rows) {
      const day = row.requestTimestamp.toISOString().split('T')[0];
      (byDay[day] ??= []).push(row);
    }

    return Object.entries(byDay).map(([day, dayRows]) => {
      const inputT = dayRows.reduce((s, r) => s + r.inputTokens, 0);
      const outputT = dayRows.reduce((s, r) => s + r.outputTokens, 0);
      const totalCost = dayRows.reduce((s, r) => s + r.totalCost, 0);
      return {
        agentId,
        period: { start: `${day}T00:00:00Z`, end: `${day}T23:59:59Z` },
        costs: {
          compute: 0,
          storage: 0,
          network: 0,
          apiCalls: dayRows.length * 0.001,
          modelTokens: totalCost,
        },
        usage: {
          requests: dayRows.length,
          tokens: { prompt: inputT, completion: outputT },
          computeTime: 0,
          storageBytes: 0,
        },
        rates: { perRequest: 0.001, perThousandTokens: 0.02, perComputeHour: 0.50, perGBStorage: 0.10 },
      } satisfies AgentCostMetrics;
    });
  }

  /**
   * Return aggregated costs for an entire organization over a period.
   * Sources from aiTokenDailyAggregation for efficiency.
   */
  async getOrganizationCosts(
    organizationId: string,
    period: { start: string; end: string }
  ): Promise<{
    totalCost: number;
    byAgent: Record<string, number>;
    byCategory: { compute: number; storage: number; network: number; apiCalls: number; modelTokens: number };
    dailyBreakdown: Array<{ date: string; cost: number }>;
  }> {
    const orgId = parseInt(organizationId);
    if (isNaN(orgId)) {
      return { totalCost: 0, byAgent: {}, byCategory: { compute: 0, storage: 0, network: 0, apiCalls: 0, modelTokens: 0 }, dailyBreakdown: [] };
    }

    const aggs = await db
      .select()
      .from(aiTokenDailyAggregation)
      .where(and(
        eq(aiTokenDailyAggregation.organizationId, orgId),
        gte(aiTokenDailyAggregation.date, new Date(period.start)),
        lte(aiTokenDailyAggregation.date, new Date(period.end)),
      ))
      .orderBy(aiTokenDailyAggregation.date)
      .limit(365);

    const byAgent: Record<string, number> = {};
    const dailyBreakdown: Array<{ date: string; cost: number }> = [];
    let totalCost = 0;

    for (const agg of aggs) {
      const dayCost = agg.totalCost;
      totalCost += dayCost;
      dailyBreakdown.push({ date: agg.date.toISOString().split('T')[0], cost: Math.round(dayCost * 100) / 100 });

      // jobBreakdown contains per-job costs if populated by tokenTrackingService
      const jobs = (agg.jobBreakdown as Record<string, { cost: number }> | null) ?? {};
      for (const [jobId, stats] of Object.entries(jobs)) {
        byAgent[jobId] = (byAgent[jobId] ?? 0) + stats.cost;
      }
    }

    return {
      totalCost: Math.round(totalCost * 100) / 100,
      byAgent,
      byCategory: { compute: 0, storage: 0, network: 0, apiCalls: 0, modelTokens: Math.round(totalCost * 100) / 100 },
      dailyBreakdown,
    };
  }

  // ─── Invoicing ────────────────────────────────────────────────────────────

  /**
   * Generate a billing record from real spend data.
   * Tax rate must be configured via BILLING_TAX_RATE env var (no default).
   */
  async generateBillingRecord(
    organizationId: string,
    period: { start: string; end: string }
  ): Promise<BillingRecord> {
    const costs = await this.getOrganizationCosts(organizationId, period);

    const taxRate = parseFloat(process.env.BILLING_TAX_RATE ?? '');
    if (isNaN(taxRate)) throw new Error('BILLING_TAX_RATE env var is not configured');

    const items = Object.entries(costs.byAgent).map(([jobId, amount]) => ({
      agentId: jobId,
      description: `AI token usage for job ${jobId}`,
      quantity: 1,
      unitPrice: amount,
      amount,
    }));

    const subtotal = costs.totalCost;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    const record: BillingRecord = {
      id: randomUUID(),
      organizationId,
      period,
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total: Math.round(total * 100) / 100,
      status: 'draft',
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };

    logger.info('Billing record generated', { recordId: record.id, organizationId, total: record.total });
    return record;
  }

  // getBillingRecord / getBillingRecords are stubs — invoices are managed by Stripe
  getBillingRecord(_id: string): BillingRecord | undefined { return undefined; }
  getBillingRecords(_organizationId: string): BillingRecord[] { return []; }

  // ─── Budget alerts ────────────────────────────────────────────────────────

  async createBudgetAlert(request: CreateBudgetAlertRequest): Promise<BudgetAlert> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const costs = await this.getOrganizationCosts(request.organizationId, {
      start: startOfMonth.toISOString(),
      end: now.toISOString(),
    });

    const percentUsed = (costs.totalCost / request.budget) * 100;
    const alert: BudgetAlert = {
      id: randomUUID(),
      organizationId: request.organizationId,
      type: 'threshold',
      threshold: request.threshold,
      currentSpend: costs.totalCost,
      budget: request.budget,
      status: 'active',
      severity: percentUsed >= 90 ? 'critical' : percentUsed >= 75 ? 'high' : 'medium',
      message: `Budget alert: ${Math.round(percentUsed)}% of monthly budget used ($${costs.totalCost.toFixed(2)} / $${request.budget})`,
      triggeredAt: now.toISOString(),
    };

    this.budgetAlerts.set(alert.id, alert);
    this.emit('alert:created', alert);
    return alert;
  }

  private async checkBudgetThresholds(organizationId: string): Promise<void> {
    const alerts = Array.from(this.budgetAlerts.values())
      .filter(a => a.organizationId === organizationId && a.status === 'active');
    if (alerts.length === 0) return;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const costs = await this.getOrganizationCosts(organizationId, {
      start: startOfMonth.toISOString(),
      end: now.toISOString(),
    });

    for (const alert of alerts) {
      const percentUsed = (costs.totalCost / alert.budget) * 100;
      if (percentUsed >= alert.threshold) {
        alert.currentSpend = costs.totalCost;
        alert.severity = percentUsed >= 90 ? 'critical' : percentUsed >= 75 ? 'high' : 'medium';
        alert.message = `Budget alert: ${Math.round(percentUsed)}% of monthly budget used ($${costs.totalCost.toFixed(2)} / $${alert.budget})`;
        this.emit('alert:triggered', alert);
      }
    }
  }

  getActiveAlerts(organizationId: string): BudgetAlert[] {
    return Array.from(this.budgetAlerts.values())
      .filter(a => a.organizationId === organizationId && a.status === 'active');
  }

  async resolveAlert(alertId: string): Promise<void> {
    const alert = this.budgetAlerts.get(alertId);
    if (!alert) return;
    alert.status = 'resolved';
    alert.resolvedAt = new Date().toISOString();
    this.emit('alert:resolved', alert);
  }

  // ─── Recommendations ──────────────────────────────────────────────────────

  /**
   * Generate cost recommendations from real spend data.
   * Thresholds are based on actual aggregated token costs, not guessed savings %.
   */
  async generateRecommendations(organizationId: string): Promise<CostOptimizationRecommendation[]> {
    const now = new Date().toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const costs = await this.getOrganizationCosts(organizationId, { start: thirtyDaysAgo, end: now });
    const recommendations: CostOptimizationRecommendation[] = [];

    if (costs.totalCost > 50) {
      recommendations.push({
        id: randomUUID(),
        organizationId,
        agentId: undefined,
        category: 'model_selection',
        title: 'Review model selection for routine tasks',
        description: `$${costs.totalCost.toFixed(2)} spent on AI tokens in the last 30 days. Routing lower-complexity tasks to smaller models can reduce this cost.`,
        currentCost: costs.totalCost,
        projectedSavings: null,   // not guessed
        savingsPercentage: null,  // not guessed
        effort: 'medium',
        impact: 'high',
        implementation: {
          steps: ['Audit task complexity distribution', 'Configure model routing rules', 'Monitor quality metrics after routing changes'],
          automated: false,
          canAutoApply: false,
        },
        status: 'pending',
        createdAt: now,
      });
    }

    // High single-day spike detection
    const maxDayCost = Math.max(0, ...costs.dailyBreakdown.map(d => d.cost));
    const avgDayCost = costs.totalCost / Math.max(costs.dailyBreakdown.length, 1);
    if (maxDayCost > avgDayCost * 3 && maxDayCost > 5) {
      recommendations.push({
        id: randomUUID(),
        organizationId,
        agentId: undefined,
        category: 'compute_optimization',
        title: 'Investigate cost spikes',
        description: `Peak daily cost ($${maxDayCost.toFixed(2)}) was 3× the 30-day average ($${avgDayCost.toFixed(2)}). Review jobs running on that day for runaway loops.`,
        currentCost: maxDayCost,
        projectedSavings: null,
        savingsPercentage: null,
        effort: 'low',
        impact: 'medium',
        implementation: {
          steps: ['Identify the high-cost date in the daily breakdown', 'Inspect job logs for that period', 'Apply token budgets to high-volume jobs'],
          automated: false,
          canAutoApply: false,
        },
        status: 'pending',
        createdAt: now,
      });
    }

    recommendations.forEach(r => this.recommendations.set(r.id, r));
    return recommendations;
  }

  getRecommendations(organizationId: string): CostOptimizationRecommendation[] {
    return Array.from(this.recommendations.values())
      .filter(r => r.organizationId === organizationId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async applyRecommendation(recommendationId: string, autoApply = false): Promise<void> {
    const rec = this.recommendations.get(recommendationId);
    if (!rec) throw new Error(`Recommendation ${recommendationId} not found`);
    if (autoApply && !rec.implementation.canAutoApply) throw new Error('This recommendation cannot be auto-applied');
    rec.status = autoApply ? 'applied' : 'implemented';
    rec.appliedAt = new Date().toISOString();
    this.emit('recommendation:applied', rec);
  }

  // ─── Forecast ─────────────────────────────────────────────────────────────

  /**
   * Project future costs based on actual trailing spend.
   * No artificial confidence scores or growth assumptions.
   */
  async getCostForecast(
    organizationId: string,
    days = 30
  ): Promise<{
    projectedCost: number;
    confidence: number;
    breakdown: Array<{ date: string; projectedCost: number }>;
    riskFactors: string[];
  }> {
    const trailingDays = 30;
    const start = new Date(Date.now() - trailingDays * 24 * 60 * 60 * 1000).toISOString();
    const historical = await this.getOrganizationCosts(organizationId, {
      start,
      end: new Date().toISOString(),
    });

    const activeDays = historical.dailyBreakdown.filter(d => d.cost > 0).length;
    if (activeDays === 0) {
      return { projectedCost: 0, confidence: 0, breakdown: [], riskFactors: ['No historical spend data available'] };
    }

    const dailyAvg = historical.totalCost / activeDays;

    // Confidence: higher when we have more data points (capped at 0.9)
    const confidence = Math.min(0.9, activeDays / trailingDays);

    const breakdown = Array.from({ length: days }, (_, i) => {
      const date = new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000);
      return { date: date.toISOString().split('T')[0], projectedCost: Math.round(dailyAvg * 100) / 100 };
    });

    const projectedCost = Math.round(dailyAvg * days * 100) / 100;

    const riskFactors: string[] = [];
    if (activeDays < 7) riskFactors.push('Fewer than 7 days of history — projection may be unreliable');
    if (historical.byCategory.modelTokens > historical.totalCost * 0.8) {
      riskFactors.push('AI token costs dominate spend — sensitive to usage volume changes');
    }

    return { projectedCost, confidence, breakdown, riskFactors };
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  async getDashboardData(organizationId: string): Promise<{
    currentMonthCost: number;
    previousMonthCost: number;
    changePercent: number;
    topAgents: Array<{ agentId: string; cost: number; percentOfTotal: number }>;
    costBreakdown: Record<string, number>;
    activeAlerts: BudgetAlert[];
    pendingRecommendations: CostOptimizationRecommendation[];
    potentialSavings: number;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [currentMonth, previousMonth] = await Promise.all([
      this.getOrganizationCosts(organizationId, { start: startOfMonth.toISOString(), end: now.toISOString() }),
      this.getOrganizationCosts(organizationId, { start: startOfPrevMonth.toISOString(), end: endOfPrevMonth.toISOString() }),
    ]);

    const changePercent = previousMonth.totalCost > 0
      ? Math.round(((currentMonth.totalCost - previousMonth.totalCost) / previousMonth.totalCost) * 10000) / 100
      : 0;

    const topAgents = Object.entries(currentMonth.byAgent)
      .map(([agentId, cost]) => ({
        agentId,
        cost,
        percentOfTotal: currentMonth.totalCost > 0 ? Math.round((cost / currentMonth.totalCost) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);

    const activeAlerts = this.getActiveAlerts(organizationId);
    const pendingRecommendations = this.getRecommendations(organizationId).filter(r => r.status === 'pending');

    return {
      currentMonthCost: currentMonth.totalCost,
      previousMonthCost: previousMonth.totalCost,
      changePercent,
      topAgents,
      costBreakdown: currentMonth.byCategory,
      activeAlerts,
      pendingRecommendations,
      potentialSavings: 0, // not guessed
    };
  }
}

export const costTrackingService = new CostTrackingService();
