/**
 * Meta-Cognitive Planning Service
 * 
 * Enables agents to plan their own reasoning strategies, monitor their
 * cognitive processes, and adapt strategies based on task characteristics
 * and past performance.
 */

import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { 
  STRATEGY_DEFINITIONS, 
  ReasoningStrategy, 
  StrategyConfig,
  recommendStrategies 
} from "./reasoning-strategies.js";
import { v4 as uuidv4 } from "uuid";
import { strategyMLService, TaskFeatures } from "../ml-strategy-predictor/strategy-ml.service.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("MetaCognitivePlanner");

// Types
export interface TaskCharacteristics {
  description: string;
  complexity: "low" | "medium" | "high";
  domain: string;
  hasStructuredData: boolean;
  requiresCreativity: boolean;
  hasTimeConstraint: boolean;
  expectedSteps?: number;
  riskLevel: "low" | "medium" | "high";
  novelty: "routine" | "familiar" | "novel";
}

export interface AgentCognitiveState {
  agentId: string;
  currentStrategy?: ReasoningStrategy;
  confidence: number;
  fatigue: number; // 0-1, increases with long sessions
  recentAccuracy: number; // 0-1, based on last N tasks
  preferredStrategies: ReasoningStrategy[];
  successfulStrategies: Map<ReasoningStrategy, number>; // success count
  failedStrategies: Map<ReasoningStrategy, number>; // failure count
  avgTimePerStrategy: Map<ReasoningStrategy, number>; // average seconds
}

export interface CognitivePlan {
  id: string;
  agentId: string;
  organizationId: number;
  taskId: string;
  selectedStrategy: ReasoningStrategy;
  strategyConfig: StrategyConfig;
  reasoning: string;
  fallbackStrategies: ReasoningStrategy[];
  estimatedSteps: number;
  estimatedTimeMs: number;
  checkpoints: Array<{
    step: number;
    description: string;
    verify: boolean;
  }>;
  adaptationRules: Array<{
    condition: string;
    action: string;
  }>;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: "planned" | "executing" | "completed" | "failed" | "adapted";
  outcome?: {
    success: boolean;
    actualSteps: number;
    actualTimeMs: number;
    quality: number;
    lessons: string[];
  };
}

export interface StrategyPerformance {
  strategy: ReasoningStrategy;
  usageCount: number;
  successRate: number;
  avgTimeMs: number;
  avgQuality: number;
  bestDomain: string;
  worstDomain: string;
}

/**
 * Meta-Cognitive Planning Service
 * 
 * This service enables agents to:
 * 1. Analyze task characteristics
 * 2. Select optimal reasoning strategies
 * 3. Plan execution with checkpoints
 * 4. Monitor and adapt during execution
 * 5. Learn from outcomes
 */
export class MetaCognitivePlannerService {
  private agentStates: Map<string, AgentCognitiveState> = new Map();
  private activePlans: Map<string, CognitivePlan> = new Map();
  private planHistory: Map<string, CognitivePlan[]> = new Map(); // agentId -> plans
  private globalPerformance: Map<ReasoningStrategy, StrategyPerformance> = new Map();

  constructor() {
    this.initializePerformanceTracking();
  }

  private initializePerformanceTracking() {
    // Initialize performance tracking for all strategies
    for (const strategy of Object.keys(STRATEGY_DEFINITIONS) as ReasoningStrategy[]) {
      this.globalPerformance.set(strategy, {
        strategy,
        usageCount: 0,
        successRate: 0.5, // Start neutral
        avgTimeMs: 0,
        avgQuality: 0,
        bestDomain: "unknown",
        worstDomain: "unknown",
      });
    }
  }

  // ============================================================================
  // AGENT STATE MANAGEMENT
  // ============================================================================

  /**
   * Initialize or update agent cognitive state
   */
  initializeAgent(agentId: string, initialState?: Partial<AgentCognitiveState>): AgentCognitiveState {
    const existing = this.agentStates.get(agentId);
    
    if (existing) {
      // Update existing
      const updated = { ...existing, ...initialState };
      this.agentStates.set(agentId, updated);
      return updated;
    }

    // Create new
    const state: AgentCognitiveState = {
      agentId,
      confidence: 0.8,
      fatigue: 0,
      recentAccuracy: 0.8,
      preferredStrategies: ["chain_of_thought", "step_by_step"],
      successfulStrategies: new Map(),
      failedStrategies: new Map(),
      avgTimePerStrategy: new Map(),
      ...initialState,
    };

    this.agentStates.set(agentId, state);
    this.planHistory.set(agentId, []);
    
    logger.info(`[MetaCognitivePlanner] Initialized agent ${agentId}`);
    return state;
  }

  /**
   * Get agent cognitive state
   */
  getAgentState(agentId: string): AgentCognitiveState | undefined {
    return this.agentStates.get(agentId);
  }

  /**
   * Update agent state after task completion
   */
  updateAgentState(
    agentId: string,
    plan: CognitivePlan,
    success: boolean,
    timeMs: number
  ): void {
    const state = this.agentStates.get(agentId);
    if (!state) return;

    const strategy = plan.selectedStrategy;

    // Update success/failure counts
    if (success) {
      state.successfulStrategies.set(
        strategy,
        (state.successfulStrategies.get(strategy) || 0) + 1
      );
      state.confidence = Math.min(0.95, state.confidence + 0.02);
    } else {
      state.failedStrategies.set(
        strategy,
        (state.failedStrategies.get(strategy) || 0) + 1
      );
      state.confidence = Math.max(0.3, state.confidence - 0.05);
    }

    // Update average time for strategy
    const currentAvg = state.avgTimePerStrategy.get(strategy) || timeMs;
    const count = (state.successfulStrategies.get(strategy) || 0) + 
                  (state.failedStrategies.get(strategy) || 0);
    const newAvg = (currentAvg * (count - 1) + timeMs) / count;
    state.avgTimePerStrategy.set(strategy, newAvg);

    // Calculate recent accuracy
    let totalSuccess = 0;
    let totalAttempts = 0;
    for (const [strat, count] of state.successfulStrategies) {
      totalSuccess += count;
      totalAttempts += count;
    }
    for (const [strat, count] of state.failedStrategies) {
      totalAttempts += count;
    }
    state.recentAccuracy = totalAttempts > 0 ? totalSuccess / totalAttempts : 0.5;

    // Increase fatigue slightly, will reset on break
    state.fatigue = Math.min(0.9, state.fatigue + 0.05);

    logger.debug(`[MetaCognitivePlanner] Updated agent ${agentId} state: confidence=${state.confidence.toFixed(2)}, fatigue=${state.fatigue.toFixed(2)}`);
  }

  /**
   * Reset agent fatigue (call between sessions)
   */
  resetFatigue(agentId: string): void {
    const state = this.agentStates.get(agentId);
    if (state) {
      state.fatigue = 0;
      logger.debug(`[MetaCognitivePlanner] Reset fatigue for agent ${agentId}`);
    }
  }

  // ============================================================================
  // COGNITIVE PLANNING
  // ============================================================================

  /**
   * Create a cognitive plan for a task
   */
  async createPlan(
    agentId: string,
    taskId: string,
    characteristics: TaskCharacteristics,
    context?: {
      availableTools?: string[];
      deadlineMs?: number;
      previousAttempts?: number;
      organizationId?: number;
    }
  ): Promise<CognitivePlan> {
    const agentState = this.initializeAgent(agentId);
    
    // 1. Analyze task and get recommendations
    const recommended = recommendStrategies(
      characteristics.description,
      characteristics.complexity,
      characteristics.hasStructuredData,
      characteristics.requiresCreativity,
      characteristics.hasTimeConstraint ? "tight" : "none"
    );

    // 1.5 Get ML Recommendation (New!)
    let mlPrediction = null;
    if (context?.organizationId) {
      const features = this.extractTaskFeatures(characteristics);
      mlPrediction = await strategyMLService.predictStrategy(
        features,
        agentId,
        context.organizationId
      );
    }

    // 2. Score strategies based on agent state, performance, and ML
    const scoredStrategies = recommended.map(strategy => {
      let score = this.scoreStrategy(strategy, agentState, characteristics, context);
      
      // Inject ML influence if available
      if (mlPrediction) {
        if (mlPrediction.strategy === strategy) {
          score = (score * 0.6) + (mlPrediction.confidence * 0.4);
        } else {
          // Check alternatives
          const alt = mlPrediction.alternativeStrategies.find(a => a.strategy === strategy);
          if (alt) {
            score = (score * 0.8) + (alt.confidence * 0.2);
          }
        }
      }
      
      return { strategy, score };
    }).sort((a, b) => b.score - a.score);

    // 3. Select best strategy
    const selected = scoredStrategies[0]?.strategy || "chain_of_thought";
    const fallbacks = scoredStrategies.slice(1, 3).map(s => s.strategy);

    // 4. Create plan with checkpoints
    const plan: CognitivePlan = {
      id: uuidv4(),
      agentId,
      organizationId: assertOrgId(context?.organizationId),
      taskId,
      selectedStrategy: selected,
      strategyConfig: STRATEGY_DEFINITIONS[selected],
      reasoning: mlPrediction && mlPrediction.strategy === selected 
        ? mlPrediction.reasoning.join("\n")
        : this.generateReasoning(selected, characteristics, agentState),
      fallbackStrategies: fallbacks,
      estimatedSteps: this.estimateSteps(selected, characteristics),
      estimatedTimeMs: this.estimateTime(selected, agentState, characteristics),
      checkpoints: this.generateCheckpoints(selected, characteristics),
      adaptationRules: this.generateAdaptationRules(selected, characteristics),
      createdAt: new Date(),
      status: "planned",
    };

    this.activePlans.set(plan.id, plan);
    
    // Track in history
    const history = this.planHistory.get(agentId) || [];
    history.push(plan);
    this.planHistory.set(agentId, history);

    logger.info(`[MetaCognitivePlanner] Created plan ${plan.id} for agent ${agentId}: strategy=${selected}`);

    await eventStream.publish(
      "metacognitive.plan_created",
      {
        planId: plan.id,
        agentId,
        taskId,
        strategy: selected,
        estimatedSteps: plan.estimatedSteps,
      },
      { agentId, taskId },
      "metacognitive"
    );

    return plan;
  }

  /**
   * Score a strategy for selection
   */
  private scoreStrategy(
    strategy: ReasoningStrategy,
    agentState: AgentCognitiveState,
    characteristics: TaskCharacteristics,
    context?: { deadlineMs?: number }
  ): number {
    let score = 0.5;
    const config = STRATEGY_DEFINITIONS[strategy];

    // Personalization: Agent's past success with this strategy
    const successes = agentState.successfulStrategies.get(strategy) || 0;
    const failures = agentState.failedStrategies.get(strategy) || 0;
    const total = successes + failures;
    if (total > 0) {
      score += (successes / total) * 0.2;
    }

    // Personalization: Agent preference
    if (agentState.preferredStrategies.includes(strategy)) {
      score += 0.1;
    }

    // Task fit
    if (characteristics.requiresCreativity && config.allowsParallel) {
      score += 0.15;
    }

    if (characteristics.hasStructuredData && config.requiresTools) {
      score += 0.1;
    }

    // Time pressure
    if (context?.deadlineMs && config.timeEstimate === "slow") {
      const timeFits = context.deadlineMs > 60000; // > 1 min
      if (!timeFits) score -= 0.3;
    }

    // Fatigue adjustment
    if (agentState.fatigue > 0.5 && config.estimatedComplexity > 3) {
      score -= 0.1; // Prefer simpler strategies when fatigued
    }

    // Global performance
    const global = this.globalPerformance.get(strategy);
    if (global && global.usageCount > 10) {
      score += (global.successRate - 0.5) * 0.2;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Generate explanation for strategy selection
   */
  private generateReasoning(
    strategy: ReasoningStrategy,
    characteristics: TaskCharacteristics,
    agentState: AgentCognitiveState
  ): string {
    const config = STRATEGY_DEFINITIONS[strategy];
    const reasons: string[] = [];

    reasons.push(`Selected "${strategy}" strategy:`);
    reasons.push(`- Complexity: ${characteristics.complexity} matches ${config.estimatedComplexity}/5`);
    
    if (characteristics.requiresCreativity && config.allowsParallel) {
      reasons.push("- Supports parallel exploration for creative tasks");
    }
    
    const successes = agentState.successfulStrategies.get(strategy) || 0;
    if (successes > 0) {
      reasons.push(`- Past success: ${successes} successful uses`);
    }

    if (agentState.fatigue > 0.5) {
      reasons.push("- Adjusted for current cognitive load");
    }

    return reasons.join("\n");
  }

  /**
   * Estimate number of steps
   */
  private estimateSteps(strategy: ReasoningStrategy, characteristics: TaskCharacteristics): number {
    const config = STRATEGY_DEFINITIONS[strategy];
    const baseSteps = config.estimatedComplexity;
    
    let multiplier = 1;
    if (characteristics.complexity === "high") multiplier = 2;
    else if (characteristics.complexity === "medium") multiplier = 1.5;
    
    if (characteristics.novelty === "novel") multiplier *= 1.3;
    
    return Math.ceil(baseSteps * multiplier) + config.verificationSteps;
  }

  /**
   * Estimate execution time
   */
  private estimateTime(
    strategy: ReasoningStrategy,
    agentState: AgentCognitiveState,
    characteristics: TaskCharacteristics
  ): number {
    const config = STRATEGY_DEFINITIONS[strategy];
    
    const baseTime = {
      fast: 5000,
      medium: 15000,
      slow: 45000,
    }[config.timeEstimate];

    // Adjust for agent fatigue
    const fatigueFactor = 1 + (agentState.fatigue * 0.5);
    
    // Adjust for task complexity
    const complexityFactor = characteristics.complexity === "high" ? 2 : 
                            characteristics.complexity === "medium" ? 1.5 : 1;

    return baseTime * fatigueFactor * complexityFactor;
  }

  /**
   * Generate checkpoints for monitoring
   */
  private generateCheckpoints(
    strategy: ReasoningStrategy,
    characteristics: TaskCharacteristics
  ): Array<{ step: number; description: string; verify: boolean }> {
    const config = STRATEGY_DEFINITIONS[strategy];
    const checkpoints: Array<{ step: number; description: string; verify: boolean }> = [];

    // Add strategy-specific checkpoints
    switch (strategy) {
      case "chain_of_thought":
        checkpoints.push(
          { step: 1, description: "Initial understanding established", verify: true },
          { step: 3, description: "Logical progression validated", verify: true }
        );
        break;
      case "tree_of_thoughts":
        checkpoints.push(
          { step: 1, description: "Multiple paths identified", verify: true },
          { step: 2, description: "Paths evaluated", verify: true },
          { step: 4, description: "Best path selected", verify: true }
        );
        break;
      case "first_principles":
        checkpoints.push(
          { step: 1, description: "Decomposition to fundamentals complete", verify: true },
          { step: 4, description: "Rebuild from principles validated", verify: true }
        );
        break;
      default:
        checkpoints.push(
          { step: 1, description: "Strategy initiated", verify: false },
          { step: 2, description: "Progress check", verify: true }
        );
    }

    return checkpoints;
  }

  /**
   * Generate adaptation rules
   */
  private generateAdaptationRules(
    strategy: ReasoningStrategy,
    characteristics: TaskCharacteristics
  ): Array<{ condition: string; action: string }> {
    const rules: Array<{ condition: string; action: string }> = [];

    rules.push({
      condition: "Progress stalls for >30s",
      action: "Switch to simpler strategy or request clarification",
    });

    rules.push({
      condition: "Multiple verification failures",
      action: "Apply devil's advocate or critical thinking strategy",
    });

    if (characteristics.riskLevel === "high") {
      rules.push({
        condition: "High-stakes decision point",
        action: "Force additional verification step",
      });
    }

    if (characteristics.novelty === "novel") {
      rules.push({
        condition: "Unfamiliar pattern detected",
        action: "Switch to analogical or first-principles reasoning",
      });
    }

    return rules;
  }

  // ============================================================================
  // PLAN EXECUTION & MONITORING
  // ============================================================================

  /**
   * Mark plan as executing
   */
  startExecution(planId: string): CognitivePlan | undefined {
    const plan = this.activePlans.get(planId);
    if (!plan) return undefined;

    plan.status = "executing";
    plan.startedAt = new Date();

    logger.info(`[MetaCognitivePlanner] Started execution of plan ${planId}`);
    return plan;
  }

  /**
   * Check if adaptation is needed at a checkpoint
   */
  checkAdaptationNeeded(
    planId: string,
    currentStep: number,
    metrics: {
      timeSpentMs: number;
      verificationFailures: number;
      confidence: number;
    }
  ): { adapt: boolean; reason?: string; suggestedStrategy?: ReasoningStrategy } {
    const plan = this.activePlans.get(planId);
    if (!plan) return { adapt: false };

    // Check time overrun
    const timePerStep = metrics.timeSpentMs / currentStep;
    const expectedTimePerStep = plan.estimatedTimeMs / plan.estimatedSteps;
    if (timePerStep > expectedTimePerStep * 2) {
      return {
        adapt: true,
        reason: "Time overrun detected",
        suggestedStrategy: plan.fallbackStrategies[0],
      };
    }

    // Check verification failures
    if (metrics.verificationFailures >= 2) {
      return {
        adapt: true,
        reason: "Multiple verification failures",
        suggestedStrategy: "critical_thinking",
      };
    }

    // Check confidence drop
    if (metrics.confidence < 0.3) {
      return {
        adapt: true,
        reason: "Low confidence in current approach",
        suggestedStrategy: plan.fallbackStrategies[0] || "step_by_step",
      };
    }

    return { adapt: false };
  }

  /**
   * Adapt plan with new strategy
   */
  adaptPlan(planId: string, newStrategy: ReasoningStrategy): CognitivePlan | undefined {
    const plan = this.activePlans.get(planId);
    if (!plan) return undefined;

    plan.selectedStrategy = newStrategy;
    plan.strategyConfig = STRATEGY_DEFINITIONS[newStrategy];
    plan.status = "adapted";
    
    // Regenerate checkpoints
    plan.checkpoints = this.generateCheckpoints(newStrategy, {
      complexity: "medium",
      domain: "general",
      hasStructuredData: false,
      requiresCreativity: false,
      hasTimeConstraint: false,
      riskLevel: "medium",
      novelty: "familiar",
      description: "",
    });

    logger.info(`[MetaCognitivePlanner] Adapted plan ${planId} to strategy ${newStrategy}`);

    eventStream.publish(
      "metacognitive.plan_adapted",
      {
        planId,
        newStrategy,
        previousStrategy: plan.selectedStrategy,
      },
      { agentId: plan.agentId, taskId: plan.taskId },
      "metacognitive"
    );

    return plan;
  }

  /**
   * Complete plan with outcome
   */
  async completePlan(
    planId: string,
    outcome: {
      success: boolean;
      actualSteps: number;
      actualTimeMs: number;
      quality: number;
      lessons: string[];
    }
  ): Promise<CognitivePlan | undefined> {
    const plan = this.activePlans.get(planId);
    if (!plan) return undefined;

    plan.status = outcome.success ? "completed" : "failed";
    plan.completedAt = new Date();
    plan.outcome = outcome;

    // Update agent state
    this.updateAgentState(plan.agentId, plan, outcome.success, outcome.actualTimeMs);

    // Update global performance
    this.updateGlobalPerformance(plan.selectedStrategy, outcome);

    // Record performance in ML service (New!)
    try {
      const features = this.extractTaskFeatures({
        description: plan.reasoning,
        complexity: "medium",
        domain: "general",
        hasStructuredData: false,
        requiresCreativity: false,
        hasTimeConstraint: false,
        riskLevel: "medium",
        novelty: "familiar"
      });
      
      await strategyMLService.recordPerformance({
        strategy: plan.selectedStrategy,
        taskFeatures: features,
        success: outcome.success,
        qualityScore: outcome.quality,
        executionTimeMs: outcome.actualTimeMs,
        tokenUsage: 0, 
        correctionCount: 0,
        agentId: plan.agentId,
        organizationId: plan.organizationId,
      });
    } catch (err) {
      logger.warn("[MetaCognitivePlanner] Failed to record ML performance", err as any);
    }

    logger.info(`[MetaCognitivePlanner] Completed plan ${planId}: success=${outcome.success}, quality=${outcome.quality}`);

    await eventStream.publish(
      "metacognitive.plan_completed",
      {
        planId,
        success: outcome.success,
        quality: outcome.quality,
        strategy: plan.selectedStrategy,
        actualTimeMs: outcome.actualTimeMs,
      },
      { agentId: plan.agentId, taskId: plan.taskId },
      "metacognitive"
    );

    return plan;
  }

  /**
   * Update global strategy performance
   */
  private updateGlobalPerformance(strategy: ReasoningStrategy, outcome: { success: boolean; quality: number; actualTimeMs: number }): void {
    const perf = this.globalPerformance.get(strategy);
    if (!perf) return;

    perf.usageCount++;
    
    // Update success rate with exponential moving average
    const alpha = 0.1;
    const newSuccess = outcome.success ? 1 : 0;
    perf.successRate = (perf.successRate * (1 - alpha)) + (newSuccess * alpha);

    // Update average quality
    perf.avgQuality = (perf.avgQuality * (perf.usageCount - 1) + outcome.quality) / perf.usageCount;

    // Update average time
    perf.avgTimeMs = (perf.avgTimeMs * (perf.usageCount - 1) + outcome.actualTimeMs) / perf.usageCount;
  }

  // ============================================================================
  // QUERIES
  // ============================================================================

  /**
   * Get active plan
   */
  getPlan(planId: string): CognitivePlan | undefined {
    return this.activePlans.get(planId);
  }

  /**
   * Get agent's plan history
   */
  getAgentHistory(agentId: string): CognitivePlan[] {
    return this.planHistory.get(agentId) || [];
  }

  /**
   * Get strategy performance stats
   */
  getStrategyPerformance(strategy?: ReasoningStrategy): StrategyPerformance | Map<ReasoningStrategy, StrategyPerformance> {
    if (strategy) {
      return this.globalPerformance.get(strategy)!;
    }
    return new Map(this.globalPerformance);
  }

  /**
   * Get agent's preferred strategies based on history
   */
  getAgentPreferredStrategies(agentId: string, limit: number = 3): Array<{ strategy: ReasoningStrategy; score: number }> {
    const state = this.agentStates.get(agentId);
    if (!state) return [];

    const strategies = Object.keys(STRATEGY_DEFINITIONS) as ReasoningStrategy[];
    
    return strategies.map(strategy => {
      const successes = state.successfulStrategies.get(strategy) || 0;
      const failures = state.failedStrategies.get(strategy) || 0;
      const total = successes + failures;
      
      let score = 0;
      if (total > 0) {
        score = (successes / total) * 0.7 + (Math.min(total, 10) / 10) * 0.3;
      }
      
      return { strategy, score };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Get insights for an agent
   */
  getAgentInsights(agentId: string): {
    recommendedStrategies: Array<{ strategy: ReasoningStrategy; score: number }>;
    improvementAreas: string[];
    avgPerformance: {
      successRate: number;
      avgQuality: number;
      avgTimeMs: number;
    };
  } {
    const history = this.getAgentHistory(agentId);
    const completed = history.filter(p => p.outcome);

    if (completed.length === 0) {
      return {
        recommendedStrategies: [],
        improvementAreas: ["Need more task history for insights"],
        avgPerformance: { successRate: 0, avgQuality: 0, avgTimeMs: 0 },
      };
    }

    const successCount = completed.filter(p => p.outcome!.success).length;
    const avgQuality = completed.reduce((sum, p) => sum + p.outcome!.quality, 0) / completed.length;
    const avgTime = completed.reduce((sum, p) => sum + p.outcome!.actualTimeMs, 0) / completed.length;

    const insights: string[] = [];
    if (successCount / completed.length < 0.7) {
      insights.push("Success rate below target - consider simpler strategies");
    }
    if (avgQuality < 0.7) {
      insights.push("Quality scores could improve - add more verification steps");
    }

    return {
      recommendedStrategies: this.getAgentPreferredStrategies(agentId),
      improvementAreas: insights,
      avgPerformance: {
        successRate: successCount / completed.length,
        avgQuality,
        avgTimeMs: avgTime,
      },
    };
  }

  /**
   * Helper to extract task features from characteristics
   */
  private extractTaskFeatures(chars: TaskCharacteristics): TaskFeatures {
    const desc = chars.description || "";
    
    // Word count
    const wordCount = desc.split(/\s+/).length;
    
    // Question count
    const questionCount = (desc.match(/\?/g) || []).length;
    
    // Keyword density (simple)
    const keywords = ["data", "analyze", "create", "problem", "code", "logic", "reason"];
    const keywordDensity: Record<string, number> = {};
    
    for (const kw of keywords) {
      const count = (desc.toLowerCase().match(new RegExp(kw, "g")) || []).length;
      keywordDensity[kw] = count / Math.max(1, wordCount);
    }

    return {
      description: desc,
      complexity: chars.complexity,
      domain: chars.domain,
      hasStructuredData: chars.hasStructuredData,
      requiresCreativity: chars.requiresCreativity,
      hasTimeConstraint: chars.hasTimeConstraint,
      expectedSteps: chars.expectedSteps || 5,
      riskLevel: chars.riskLevel,
      novelty: chars.novelty,
      wordCount,
      questionCount,
      keywordDensity,
    };
  }
}

export const metaCognitivePlanner = new MetaCognitivePlannerService();
