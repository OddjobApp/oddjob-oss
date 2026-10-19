/**
 * Strategy Prediction ML Module
 * 
 * Machine learning system for predicting optimal reasoning strategies.
 * 
 * @example
 * ```typescript
 * import { strategyMLService, StrategyMLService } from "@domain/agents/core/ml-strategy-predictor";
 * 
 * // Predict best strategy for a task
 * const prediction = await strategyMLService.predictStrategy(
 *   {
 *     description: "Analyze complex data",
 *     complexity: "high",
 *     domain: "analytics",
 *     hasStructuredData: true,
 *     requiresCreativity: false,
 *     hasTimeConstraint: false,
 *     expectedSteps: 5,
 *     riskLevel: "medium",
 *     novelty: "familiar",
 *     wordCount: 50,
 *     questionCount: 2,
 *     keywordDensity: { analyze: 0.2, data: 0.3 }
 *   },
 *   "agent-1",
 *   1
 * );
 * 
 * console.log(prediction.strategy);        // "tree_of_thoughts"
 * console.log(prediction.confidence);     // 0.85
 * console.log(prediction.reasoning);       // ["High success rate...", ...]
 * 
 * // Record actual performance for learning
 * await strategyMLService.recordPerformance({
 *   strategy: prediction.strategy,
 *   taskFeatures: prediction.taskFeatures,
 *   success: true,
 *   qualityScore: 0.9,
 *   executionTimeMs: 15000,
 *   tokenUsage: 2500,
 *   correctionCount: 1,
 *   agentId: "agent-1",
 *   organizationId: 1
 * });
 * ```
 */

// Core service
export {
  strategyMLService,
  StrategyMLService,
  type TaskFeatures,
  type StrategyPerformanceRecord,
  type StrategyPrediction,
  type ModelMetrics,
} from "./strategy-ml.service.js";

// Database schema
export {
  strategyPerformanceLogs,
  mlStrategyPredictions,
  strategyModelVersions,
  type StrategyPerformanceLog,
  type InsertStrategyPerformanceLog,
  type MLStrategyPrediction,
  type InsertMLStrategyPrediction,
  type StrategyModelVersion,
  type InsertStrategyModelVersion,
} from "./strategy-ml.schema.js";
