/**
 * Strategy Prediction ML Service
 * 
 * Machine learning system for predicting optimal reasoning strategies
 * based on task characteristics and historical performance data.
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { strategyPerformanceLogs, mlStrategyPredictions, strategyModelVersions } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { ReasoningStrategy } from "../meta-cognitive/reasoning-strategies.js";

const logger = createLogger("StrategyML");

// Types
export interface TaskFeatures {
  description: string;
  complexity: "low" | "medium" | "high";
  domain: string;
  hasStructuredData: boolean;
  requiresCreativity: boolean;
  hasTimeConstraint: boolean;
  expectedSteps: number;
  riskLevel: "low" | "medium" | "high";
  novelty: "routine" | "familiar" | "novel";
  // Extracted features
  wordCount: number;
  questionCount: number;
  keywordDensity: Record<string, number>;
}

export interface StrategyPerformanceRecord {
  id?: number;
  strategy: ReasoningStrategy;
  taskFeatures: TaskFeatures;
  success: boolean;
  qualityScore: number;
  executionTimeMs: number;
  tokenUsage: number;
  correctionCount: number;
  agentId: string;
  organizationId: number;
  createdAt?: Date;
}

export interface StrategyPrediction {
  strategy: ReasoningStrategy;
  confidence: number;
  expectedSuccessRate: number;
  expectedQuality: number;
  expectedTimeMs: number;
  reasoning: string[];
  alternativeStrategies: Array<{
    strategy: ReasoningStrategy;
    confidence: number;
  }>;
}

export interface ModelMetrics {
  totalPredictions: number;
  accuracy: number;
  avgConfidence: number;
  strategiesEvaluated: number;
  lastTrainingAt?: Date;
}

/**
 * Strategy Prediction ML Service
 * 
 * Uses historical performance data to predict which reasoning strategy
 * will work best for a given task. Learns from outcomes continuously.
 */
/** Aggregate outcomes for one strategy, within one organization. */
interface StrategyStat {
  totalUses: number;
  successes: number;
  avgQuality: number;
  avgTimeMs: number;
}

/** Everything this service learns. Scoped to one organization, never shared. */
interface OrgModel {
  /** Feature importance weights: the defaults, or those of the active version. */
  weights: Map<string, number>;
  /** Per-strategy outcomes for THIS org only. */
  performance: Map<ReasoningStrategy, StrategyStat>;
  /** Registry version the weights came from; DEFAULT_VERSION when untrained. */
  version: string;
}

const DEFAULT_VERSION = "default";

/**
 * Below this many held-out records, an AUC delta is noise. A retrain still
 * runs and reports, it just will not activate on that evidence.
 */
const MIN_VALIDATION_RECORDS = 20;

/** Starting weights for an org with no trained version. Keys match strategyProfiles. */
function defaultWeights(): Map<string, number> {
  return new Map<string, number>([
    ["complexity", 0.25],
    ["hasData", 0.15],
    ["requiresCreativity", 0.15],
    ["timePressure", 0.10],
    ["novelty", 0.10],
    ["riskLevel", 0.10],
    ["domain_match", 0.15],
  ]);
}

export class StrategyMLService {
  /**
   * Learned state, keyed by organization.
   *
   * This was previously two instance fields on a singleton, and both leaked
   * across tenants: retrainModel(orgId) assigned `this.featureWeights`
   * wholesale, and loadHistoricalPerformance() aggregated
   * strategy_performance_logs with no WHERE clause whatsoever. One customer's
   * outcomes therefore steered every other customer's predictions — while
   * calculateConfidence() accepted an organizationId and ignored it, which is
   * what made the leak invisible at the call sites.
   */
  private orgModels = new Map<number, OrgModel>();

  /** De-dupes concurrent first-loads of the same org. */
  private inflight = new Map<number, Promise<OrgModel>>();

  /**
   * Bounds the cache in a long-lived process. Eviction is safe: the database is
   * the source of truth and an evicted org simply reloads on next use.
   */
  private static readonly MAX_CACHED_ORGS = 200;

  /**
   * Resolve (loading if needed) the model for one organization.
   *
   * Weights come from the active strategy_model_versions row so a retrain
   * survives restart; absent one, an org starts on the defaults.
   */
  private async modelFor(organizationId: number): Promise<OrgModel> {
    const cached = this.orgModels.get(organizationId);
    if (cached) {
      // Refresh LRU position.
      this.orgModels.delete(organizationId);
      this.orgModels.set(organizationId, cached);
      return cached;
    }

    const pending = this.inflight.get(organizationId);
    if (pending) return pending;

    const load = (async (): Promise<OrgModel> => {
      const model: OrgModel = {
        weights: defaultWeights(),
        performance: new Map(),
        version: DEFAULT_VERSION,
      };

      try {
        const [active] = await db
          .select()
          .from(strategyModelVersions)
          .where(and(
            eq(strategyModelVersions.organizationId, organizationId),
            eq(strategyModelVersions.isActive, true),
          ))
          .orderBy(desc(strategyModelVersions.createdAt))
          .limit(1);

        if (active?.featureWeights) {
          const stored = active.featureWeights as Record<string, number>;
          for (const [feature, weight] of Object.entries(stored)) {
            if (Number.isFinite(weight)) model.weights.set(feature, weight);
          }
          model.version = active.version;
        }
      } catch (err: any) {
        // Falling back to defaults is correct here: an unreadable registry
        // should degrade prediction quality, not break prediction.
        logger.warn(`[StrategyML] Could not load active model for org ${organizationId}:`, err);
      }

      await this.loadHistoricalPerformance(organizationId, model);

      this.orgModels.set(organizationId, model);
      while (this.orgModels.size > StrategyMLService.MAX_CACHED_ORGS) {
        const oldest = this.orgModels.keys().next().value;
        if (oldest === undefined) break;
        this.orgModels.delete(oldest);
      }
      return model;
    })().finally(() => this.inflight.delete(organizationId));

    this.inflight.set(organizationId, load);
    return load;
  }

  // ============================================================================
  // PREDICTION
  // ============================================================================

  /**
   * Predict optimal strategy for a task
   */
  async predictStrategy(
    taskFeatures: TaskFeatures,
    agentId: string,
    organizationId: number
  ): Promise<StrategyPrediction> {
    logger.info(`[StrategyML] Predicting strategy for task: ${taskFeatures.description.slice(0, 50)}...`);

    // Resolve this org's own model before scoring anything against it.
    const model = await this.modelFor(organizationId);

    // Extract enhanced features
    const features = this.extractFeatures(taskFeatures);

    // Score all strategies
    const strategyScores = await this.scoreAllStrategies(features, organizationId, model);

    // Sort by score
    const sorted = strategyScores.sort((a, b) => b.score - a.score);

    // Get top prediction
    const top = sorted[0];
    const alternatives = sorted.slice(1, 4);

    // Calculate confidence based on data availability
    const confidence = this.calculateConfidence(top.strategy, model);

    // Build reasoning
    const reasoning = this.generateReasoning(top, features);

    const prediction: StrategyPrediction = {
      strategy: top.strategy,
      confidence,
      expectedSuccessRate: top.expectedSuccess,
      expectedQuality: top.expectedQuality,
      expectedTimeMs: top.expectedTime,
      reasoning,
      alternativeStrategies: alternatives.map(a => ({
        strategy: a.strategy,
        confidence: a.score / top.score, // Relative confidence
      })),
    };

    // Log prediction for model improvement
    await this.logPrediction(prediction, features, agentId, organizationId);

    logger.info(`[StrategyML] Predicted ${prediction.strategy} with ${(confidence * 100).toFixed(1)}% confidence`);

    return prediction;
  }

  /**
   * Extract ML features from task
   */
  private extractFeatures(taskFeatures: TaskFeatures): Record<string, number> {
    const features: Record<string, number> = {};

    // Complexity encoding
    features.complexity = { low: 1, medium: 2, high: 3 }[taskFeatures.complexity];

    // Data availability
    features.hasData = taskFeatures.hasStructuredData ? 1 : 0;

    // Creativity requirement
    features.requiresCreativity = taskFeatures.requiresCreativity ? 1 : 0;

    // Time pressure
    features.timePressure = taskFeatures.hasTimeConstraint ? 1 : 0;

    // Novelty encoding
    features.novelty = { routine: 1, familiar: 2, novel: 3 }[taskFeatures.novelty];

    // Risk level
    features.riskLevel = { low: 1, medium: 2, high: 3 }[taskFeatures.riskLevel];

    // Text features
    features.wordCount = taskFeatures.wordCount;
    features.questionCount = taskFeatures.questionCount;

    // Keyword density for domain detection
    for (const [keyword, density] of Object.entries(taskFeatures.keywordDensity)) {
      features[`kw_${keyword}`] = density;
    }

    return features;
  }

  /**
   * Score all strategies for given features
   */
  private async scoreAllStrategies(
    features: Record<string, number>,
    organizationId: number,
    model: OrgModel
  ): Promise<Array<{
    strategy: ReasoningStrategy;
    score: number;
    expectedSuccess: number;
    expectedQuality: number;
    expectedTime: number;
  }>> {
    const strategies: ReasoningStrategy[] = [
      "chain_of_thought",
      "tree_of_thoughts",
      "step_by_step",
      "analogical",
      "abductive",
      "deductive",
      "inductive",
      "critical_thinking",
      "creative_brainstorm",
      "first_principles",
      "devils_advocate",
      "systems_thinking",
    ];

    const scores = [];

    for (const strategy of strategies) {
      const historical = await this.getHistoricalPerformance(strategy, organizationId);
      const featureMatch = this.calculateFeatureMatch(strategy, features, model.weights);
      
      // Combined score: Prioritize feature matching especially when data is sparse
      const score = 
        (historical.successRate * 0.2) +
        (historical.avgQuality * 0.2) +
        (featureMatch * 0.5) +
        (Math.min(1, historical.totalUses / 20) * 0.1); // Experience bonus

      scores.push({
        strategy,
        score,
        expectedSuccess: historical.successRate,
        expectedQuality: historical.avgQuality,
        expectedTime: historical.avgTimeMs,
      });
    }

    return scores;
  }

  /**
   * Calculate how well strategy matches features
   */
  private calculateFeatureMatch(
    strategy: ReasoningStrategy,
    features: Record<string, number>,
    weights: Map<string, number>
  ): number {
    const strategyProfiles: Record<ReasoningStrategy, Record<string, number>> = {
      chain_of_thought: { complexity: 2, hasData: 0.5, requiresCreativity: 0.3, timePressure: 0.5 },
      tree_of_thoughts: { complexity: 3, hasData: 0.7, requiresCreativity: 0.8, timePressure: 0.2 },
      step_by_step: { complexity: 1, hasData: 0.6, requiresCreativity: 0.1, timePressure: 0.8 },
      analogical: { complexity: 2, hasData: 0.3, requiresCreativity: 0.9, novelty: 3 },
      abductive: { complexity: 3, hasData: 0.5, requiresCreativity: 0.6, novelty: 2 },
      deductive: { complexity: 1, hasData: 0.8, requiresCreativity: 0.1, riskLevel: 1 },
      inductive: { complexity: 2, hasData: 0.9, requiresCreativity: 0.4, novelty: 2 },
      critical_thinking: { complexity: 2, hasData: 0.4, requiresCreativity: 0.3, riskLevel: 2 },
      creative_brainstorm: { complexity: 2, hasData: 0.2, requiresCreativity: 1.0, timePressure: 0.5 },
      first_principles: { complexity: 3, hasData: 0.3, requiresCreativity: 0.9, novelty: 3 },
      devils_advocate: { complexity: 2, hasData: 0.3, requiresCreativity: 0.4, riskLevel: 3 },
      systems_thinking: { complexity: 3, hasData: 0.7, requiresCreativity: 0.5, novelty: 2 },
    };

    const profile = strategyProfiles[strategy];
    if (!profile) return 0.5;

    let matchScore = 0;
    let totalWeight = 0;

    for (const [feature, weight] of Object.entries(profile)) {
      const taskValue = features[feature] || 0;
      const idealValue = weight;
      
      // Calculate similarity (inverse of difference)
      const diff = Math.abs(taskValue - idealValue);
      const similarity = 1 - Math.min(1, diff / Math.max(taskValue, idealValue, 1));
      
      matchScore += similarity * (weights.get(feature) || 0.1);
      totalWeight += weights.get(feature) || 0.1;
    }

    return totalWeight > 0 ? matchScore / totalWeight : 0.5;
  }

  /**
   * Get historical performance for strategy
   */
  private async getHistoricalPerformance(
    strategy: ReasoningStrategy,
    organizationId: number
  ): Promise<{
    totalUses: number;
    successRate: number;
    avgQuality: number;
    avgTimeMs: number;
  }> {
    try {
      const [result] = await db
        .select({
          totalUses: sql<number>`count(*)`,
          successes: sql<number>`sum(case when ${strategyPerformanceLogs.success} then 1 else 0 end)`,
          qualitySum: sql<number>`sum(${strategyPerformanceLogs.qualityScore})`,
          avgTimeMs: sql<number>`avg(${strategyPerformanceLogs.executionTimeMs})`,
        })
        .from(strategyPerformanceLogs)
        .where(and(
          eq(strategyPerformanceLogs.strategy, strategy),
          eq(strategyPerformanceLogs.organizationId, organizationId)
        ));

      // Use Laplace smoothing (add-one smoothing) to handle low sample sizes
      const successes = Number(result?.successes || 0);
      const total = Number(result?.totalUses || 0);
      const qualitySum = Number(result?.qualitySum || (total * 0.7));

      return {
        totalUses: total,
        successRate: (successes + 1) / (total + 2), // Default to 0.5 with no data
        avgQuality: (qualitySum + 0.7) / (total + 1), // Default to 0.7 with no data
        avgTimeMs: Number(result?.avgTimeMs || 5000),
      };
    } catch (err: any) {
      logger.warn(`[StrategyML] Failed to get historical performance:`, err);
      return { totalUses: 0, successRate: 0.5, avgQuality: 0.7, avgTimeMs: 5000 };
    }
  }

  /**
   * Calculate confidence based on data availability
   */
  private calculateConfidence(strategy: ReasoningStrategy, model: OrgModel): number {
    const perf = model.performance.get(strategy);
    if (!perf) return 0.3; // Low confidence with no data

    // More data = higher confidence, capped at 0.95
    const dataConfidence = Math.min(0.95, perf.totalUses / 50);
    
    // Success rate affects confidence
    const successConfidence = perf.successes / (perf.totalUses || 1);

    return (dataConfidence * 0.6) + (successConfidence * 0.4);
  }

  /**
   * Generate human-readable reasoning
   */
  private generateReasoning(
    top: { strategy: ReasoningStrategy; expectedSuccess: number; expectedQuality: number },
    features: Record<string, number>
  ): string[] {
    const reasoning: string[] = [];

    reasoning.push(`Selected "${top.strategy}" based on historical performance`);

    if (top.expectedSuccess > 0.8) {
      reasoning.push(`High success rate (${(top.expectedSuccess * 100).toFixed(0)}%) on similar tasks`);
    }

    if (features.complexity > 2) {
      reasoning.push(`Well-suited for high-complexity tasks`);
    }

    if (features.requiresCreativity > 0.5) {
      reasoning.push(`Supports creative exploration required by task`);
    }

    if (features.timePressure > 0.5) {
      reasoning.push(`Optimized for time-constrained execution`);
    }

    return reasoning;
  }

  // ============================================================================
  // LEARNING
  // ============================================================================

  /**
   * Record strategy performance for learning
   */
  async recordPerformance(record: StrategyPerformanceRecord): Promise<void> {
    logger.info(`[StrategyML] Recording performance: ${record.strategy} - success=${record.success}`);

    try {
      await db.insert(strategyPerformanceLogs).values({
        strategy: record.strategy,
        taskFeatures: record.taskFeatures,
        success: record.success,
        qualityScore: record.qualityScore,
        executionTimeMs: record.executionTimeMs,
        tokenUsage: record.tokenUsage,
        correctionCount: record.correctionCount,
        agentId: record.agentId,
        organizationId: record.organizationId,
      });

      // Update in-memory stats for the recording org only. Skipped entirely if
      // that org is not resident: it will read the row back from the database
      // on next load, so warming a cache here would only risk a partial one.
      const model = this.orgModels.get(record.organizationId);
      if (model) {
        const current = model.performance.get(record.strategy) || {
          totalUses: 0,
          successes: 0,
          avgQuality: 0,
          avgTimeMs: 0,
        };

        current.totalUses++;
        if (record.success) current.successes++;
        current.avgQuality = (current.avgQuality * (current.totalUses - 1) + record.qualityScore) / current.totalUses;
        current.avgTimeMs = (current.avgTimeMs * (current.totalUses - 1) + record.executionTimeMs) / current.totalUses;

        model.performance.set(record.strategy, current);
      }

      await eventStream.publish(
        "ml.strategy_performance_recorded",
        {
          strategy: record.strategy,
          success: record.success,
          quality: record.qualityScore,
          agentId: record.agentId,
        },
        { organizationId: record.organizationId, agentId: record.agentId },
        "ml_strategy"
      );
    } catch (err: any) {
      logger.error(`[StrategyML] Failed to record performance:`, err);
    }
  }

  /**
   * Log prediction for accuracy tracking
   */
  private async logPrediction(
    prediction: StrategyPrediction,
    features: Record<string, number>,
    agentId: string,
    organizationId: number
  ): Promise<void> {
    try {
      await db.insert(mlStrategyPredictions).values({
        predictedStrategy: prediction.strategy,
        confidence: prediction.confidence,
        expectedSuccessRate: prediction.expectedSuccessRate,
        taskFeatures: features,
        agentId,
        organizationId,
      });
    } catch (err: any) {
      logger.warn(`[StrategyML] Failed to log prediction:`, err);
    }
  }

  /**
   * Update prediction with actual outcome (feedback loop)
   */
  async updatePredictionAccuracy(
    predictionId: number,
    actualStrategy: ReasoningStrategy,
    actualSuccess: boolean,
    actualQuality: number
  ): Promise<void> {
    try {
      await db
        .update(mlStrategyPredictions)
        .set({
          actualStrategy,
          actualSuccess,
          actualQuality,
          accuracyDelta: actualSuccess ? 1 : -1,
        })
        .where(eq(mlStrategyPredictions.id, predictionId));

      logger.info(`[StrategyML] Updated prediction ${predictionId} with outcome: success=${actualSuccess}`);
    } catch (err: any) {
      logger.error(`[StrategyML] Failed to update prediction:`, err);
    }
  }

  // ============================================================================
  // MODEL MANAGEMENT
  // ============================================================================

  /**
   * Load historical performance on startup
   */
  private async loadHistoricalPerformance(organizationId: number, model: OrgModel): Promise<void> {
    try {
      const results = await db
        .select({
          strategy: strategyPerformanceLogs.strategy,
          totalUses: sql<number>`count(*)`,
          successes: sql<number>`sum(case when ${strategyPerformanceLogs.success} then 1 else 0 end)`,
          avgQuality: sql<number>`avg(${strategyPerformanceLogs.qualityScore})`,
          avgTimeMs: sql<number>`avg(${strategyPerformanceLogs.executionTimeMs})`,
        })
        .from(strategyPerformanceLogs)
        // The missing filter. Without it this aggregated every tenant's rows
        // into one map that all tenants then predicted from.
        .where(eq(strategyPerformanceLogs.organizationId, organizationId))
        .groupBy(strategyPerformanceLogs.strategy);

      for (const result of results) {
        model.performance.set(result.strategy as ReasoningStrategy, {
          totalUses: Number(result.totalUses),
          successes: Number(result.successes),
          avgQuality: Number(result.avgQuality),
          avgTimeMs: Number(result.avgTimeMs),
        });
      }

      logger.info(`[StrategyML] Loaded performance for ${results.length} strategies (org ${organizationId})`);
    } catch (err: any) {
      logger.warn(`[StrategyML] Failed to load historical performance for org ${organizationId}:`, err);
    }
  }

  /**
   * Seed the database with high-quality historical performance records (bootstrap)
   * to resolve the cold-start problem and optimize feature weights from day one.
   */
  async seedPerformanceLogs(organizationId: number): Promise<number> {
    try {
      // Check if logs already exist
      const existing = await db
        .select({ count: sql<number>`count(*)` })
        .from(strategyPerformanceLogs)
        .where(eq(strategyPerformanceLogs.organizationId, organizationId));
        
      if (Number(existing[0]?.count || 0) > 10) {
        logger.info(`[StrategyML] Performance logs already exist for org ${organizationId}. Skipping seed.`);
        return 0;
      }
      
      const strategies: ReasoningStrategy[] = [
        "chain_of_thought", "tree_of_thoughts", "first_principles",
        "step_by_step", "deductive", "critical_thinking", "devils_advocate"
      ];
      
      const seedRecords: Array<any> = [];
      
      // Generate realistic bootstrap logs
      for (const strategy of strategies) {
        // High complexity tasks succeeded with chain_of_thought/tree_of_thoughts/first_principles
        if (strategy === "chain_of_thought" || strategy === "tree_of_thoughts" || strategy === "first_principles") {
          for (let i = 0; i < 15; i++) {
            seedRecords.push({
              strategy,
              taskFeatures: {
                description: "Solve a complex codebase bug or run unit test suite",
                complexity: "high",
                domain: "software_engineering",
                hasStructuredData: true,
                requiresCreativity: true,
                hasTimeConstraint: false,
                expectedSteps: 8,
                riskLevel: "medium",
                novelty: "novel",
                wordCount: 50,
                questionCount: 0,
                keywordDensity: {}
              },
              success: Math.random() > 0.15, // 85% success rate
              qualityScore: Math.floor(Math.random() * 3) + 7, // 7-10 score
              executionTimeMs: Math.floor(Math.random() * 20000) + 15000,
              tokenUsage: Math.floor(Math.random() * 8000) + 4000,
              correctionCount: Math.floor(Math.random() * 2),
              agentId: "bootstrap-agent",
              organizationId,
            });
          }
        }
        
        // Low complexity routine tasks succeeded with step_by_step/deductive
        if (strategy === "step_by_step" || strategy === "deductive") {
          for (let i = 0; i < 15; i++) {
            seedRecords.push({
              strategy,
              taskFeatures: {
                description: "Read small file or parse logs",
                complexity: "low",
                domain: "operations",
                hasStructuredData: false,
                requiresCreativity: false,
                hasTimeConstraint: true,
                expectedSteps: 2,
                riskLevel: "low",
                novelty: "routine",
                wordCount: 15,
                questionCount: 0,
                keywordDensity: {}
              },
              success: Math.random() > 0.05, // 95% success rate
              qualityScore: Math.floor(Math.random() * 2) + 8, // 8-10 score
              executionTimeMs: Math.floor(Math.random() * 2000) + 1000,
              tokenUsage: Math.floor(Math.random() * 1000) + 500,
              correctionCount: 0,
              agentId: "bootstrap-agent",
              organizationId,
            });
          }
        }
        
        // Critical thinking / safety reasoning
        if (strategy === "critical_thinking" || strategy === "devils_advocate") {
          for (let i = 0; i < 10; i++) {
            seedRecords.push({
              strategy,
              taskFeatures: {
                description: "Dangerous DB update or file deletion",
                complexity: "medium",
                domain: "system_admin",
                hasStructuredData: true,
                requiresCreativity: false,
                hasTimeConstraint: false,
                expectedSteps: 4,
                riskLevel: "high",
                novelty: "familiar",
                wordCount: 30,
                questionCount: 0,
                keywordDensity: {}
              },
              success: true, // 100% success rate under guardrails
              qualityScore: 10,
              executionTimeMs: Math.floor(Math.random() * 30000) + 20000,
              tokenUsage: Math.floor(Math.random() * 5000) + 2000,
              correctionCount: 0,
              agentId: "bootstrap-agent",
              organizationId,
            });
          }
        }
      }
      
      // Insert bootstrap records
      await db.insert(strategyPerformanceLogs).values(seedRecords);
      logger.info(`[StrategyML] Successfully seeded ${seedRecords.length} bootstrap performance logs.`);
      
      // Immediately retrain the model weights based on this new seed data!
      await this.retrainModel(organizationId);
      
      return seedRecords.length;
    } catch (err: any) {
      logger.error(`[StrategyML] Failed to seed performance logs:`, err);
      throw err;
    }
  }

  /**
   * Retrain model with recent data
   */
  async retrainModel(organizationId: number): Promise<{
    success: boolean;
    recordsProcessed: number;
    /** Held-out AUC delta vs the incumbent. Negative means the candidate was worse. */
    accuracyImprovement: number;
    /** Whether the candidate actually replaced the incumbent. */
    activated: boolean;
    /** The version now serving predictions for this org. */
    version: string;
  }> {
    logger.info(`[StrategyML] Retraining model for org ${organizationId}`);

    try {
      const model = await this.modelFor(organizationId);

      // Get recent performance data
      const recentData = await db
        .select()
        .from(strategyPerformanceLogs)
        .where(eq(strategyPerformanceLogs.organizationId, organizationId))
        .orderBy(desc(strategyPerformanceLogs.createdAt))
        .limit(1000);

      // Hold out every 5th record for validation. Deterministic rather than
      // random so a retrain is reproducible and two runs are comparable.
      const train = recentData.filter((_, i) => i % 5 !== 0);
      const validation = recentData.filter((_, i) => i % 5 === 0);

      const newWeights = this.optimizeFeatureWeights(train, model.weights);

      // Score both weight sets on data neither was fitted to. Reporting a
      // fixed 0.05 here previously meant every caller was told the model had
      // improved whether or not it had.
      const baseline = this.evaluateWeights(validation, model.weights);
      const candidate = this.evaluateWeights(validation, newWeights);
      const accuracyImprovement = candidate - baseline;

      // Never activate a model that is worse on held-out data. With too little
      // validation data to judge, keeping the incumbent is the safer default.
      const activated = validation.length >= MIN_VALIDATION_RECORDS && accuracyImprovement > 0;

      if (activated) {
        const version = `v${organizationId}-${Date.now().toString(36)}`;

        await db
          .update(strategyModelVersions)
          .set({ isActive: false })
          .where(and(
            eq(strategyModelVersions.organizationId, organizationId),
            eq(strategyModelVersions.isActive, true),
          ));

        await db.insert(strategyModelVersions).values({
          version,
          featureWeights: Object.fromEntries(newWeights),
          trainingRecordsCount: train.length,
          validationAccuracy: candidate,
          organizationId,
          trainedBy: "strategy-ml.retrainModel",
          isActive: true,
        });

        model.weights = newWeights;
        model.version = version;
        logger.info(`[StrategyML] Activated ${version} for org ${organizationId} (AUC ${baseline.toFixed(3)} -> ${candidate.toFixed(3)})`);
      } else {
        logger.info(`[StrategyML] Keeping ${model.version} for org ${organizationId}; candidate did not improve (delta ${accuracyImprovement.toFixed(3)}, ${validation.length} validation records)`);
      }

      // Refresh this org's outcome stats regardless of activation.
      model.performance.clear();
      await this.loadHistoricalPerformance(organizationId, model);

      return {
        success: true,
        recordsProcessed: recentData.length,
        accuracyImprovement,
        activated,
        version: model.version,
      };
    } catch (err: any) {
      logger.error(`[StrategyML] Model retraining failed:`, err);
      return { success: false, recordsProcessed: 0, accuracyImprovement: 0, activated: false, version: DEFAULT_VERSION };
    }
  }

  /**
   * How well a weight set separates successful runs from failed ones, as the
   * probability that a random success outscores a random failure (AUC).
   *
   * 0.5 is chance. Computed by rank rather than pairwise so 1000 records stay
   * cheap. Returns 0.5 when either class is absent — no evidence, no claim.
   */
  private evaluateWeights(records: any[], weights: Map<string, number>): number {
    const scored = records.map(r => ({
      success: Boolean(r.success),
      score: this.calculateFeatureMatch(
        r.strategy as ReasoningStrategy,
        this.numericFeatures(r.taskFeatures),
        weights,
      ),
    }));

    const positives = scored.filter(s => s.success).length;
    const negatives = scored.length - positives;
    if (positives === 0 || negatives === 0) return 0.5;

    // Mann-Whitney U via mid-ranks, so ties score as genuinely uninformative.
    const ordered = [...scored].sort((a, b) => a.score - b.score);
    const ranks = new Array(ordered.length);
    for (let i = 0; i < ordered.length; ) {
      let j = i;
      while (j + 1 < ordered.length && ordered[j + 1].score === ordered[i].score) j++;
      const midRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[k] = midRank;
      i = j + 1;
    }

    let rankSum = 0;
    ordered.forEach((s, i) => { if (s.success) rankSum += ranks[i]; });

    return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
  }

  /** Coerces a stored taskFeatures blob to the numeric map scoring expects. */
  private numericFeatures(raw: unknown): Record<string, number> {
    const out: Record<string, number> = {};
    if (raw && typeof raw === "object") {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const n = typeof value === "boolean" ? (value ? 1 : 0) : Number(value);
        if (Number.isFinite(n)) out[key] = n;
      }
    }
    return out;
  }

  /**
   * Optimize feature weights using simple correlation analysis
   */
  private optimizeFeatureWeights(data: any[], baseWeights: Map<string, number>): Map<string, number> {
    // Simplified weight optimization
    // In production, would use proper ML algorithms (gradient descent, etc.)

    const weights = new Map(baseWeights);
    
    // Count feature presence in successful vs failed tasks
    const featureSuccess: Record<string, { success: number; total: number }> = {};

    for (const record of data) {
      const features = record.taskFeatures as Record<string, any>;
      for (const [feature, value] of Object.entries(features)) {
        if (!featureSuccess[feature]) {
          featureSuccess[feature] = { success: 0, total: 0 };
        }
        featureSuccess[feature].total++;
        if (record.success) {
          featureSuccess[feature].success++;
        }
      }
    }

    // Adjust weights based on success correlation
    for (const [feature, stats] of Object.entries(featureSuccess)) {
      if (stats.total > 10) {
        const successRate = stats.success / stats.total;
        const currentWeight = weights.get(feature) || 0.1;
        // Increase weight if feature correlates with success
        const adjustment = (successRate - 0.5) * 0.1;
        weights.set(feature, Math.max(0.05, Math.min(0.5, currentWeight + adjustment)));
      }
    }

    return weights;
  }

  /**
   * Get model metrics
   */
  async getMetrics(organizationId: number): Promise<ModelMetrics> {
    try {
      const [predictionStats] = await db
        .select({
          total: sql<number>`count(*)`,
          accurate: sql<number>`sum(case when ${mlStrategyPredictions.actualSuccess} = true then 1 else 0 end)`,
          avgConfidence: sql<number>`avg(${mlStrategyPredictions.confidence})`,
        })
        .from(mlStrategyPredictions)
        .where(eq(mlStrategyPredictions.organizationId, organizationId));

      const strategies = await db
        .select({ count: sql<number>`count(distinct ${strategyPerformanceLogs.strategy})` })
        .from(strategyPerformanceLogs)
        .where(eq(strategyPerformanceLogs.organizationId, organizationId));

      return {
        totalPredictions: Number(predictionStats?.total || 0),
        accuracy: predictionStats?.total > 0 
          ? Number(predictionStats.accurate) / Number(predictionStats.total)
          : 0,
        avgConfidence: Number(predictionStats?.avgConfidence || 0),
        strategiesEvaluated: Number(strategies[0]?.count || 0),
      };
    } catch (err: any) {
      logger.error(`[StrategyML] Failed to get metrics:`, err);
      return { totalPredictions: 0, accuracy: 0, avgConfidence: 0, strategiesEvaluated: 0 };
    }
  }

  /**
   * Export model for backup/analysis
   */
  async exportModel(organizationId: number): Promise<{
    version: string;
    featureWeights: Record<string, number>;
    strategyPerformance: Record<string, any>;
  }> {
    const model = await this.modelFor(organizationId);
    return {
      version: model.version,
      featureWeights: Object.fromEntries(model.weights),
      strategyPerformance: Object.fromEntries(model.performance),
    };
  }
}

export const strategyMLService = new StrategyMLService();
