/**
 * Meta-Cognitive Planning System
 * 
 * Enables agents to plan their own reasoning strategies, monitor their
 * cognitive processes, and adapt strategies based on task characteristics
 * and past performance.
 * 
 * @example
 * ```typescript
 * import { metaCognitivePlanner, cognitiveMonitor } from "@domain/agents/core/meta-cognitive";
 * 
 * // Create a cognitive plan
 * const plan = await metaCognitivePlanner.createPlan(
 *   "agent-1",
 *   "task-123",
 *   {
 *     description: "Analyze customer feedback data",
 *     complexity: "high",
 *     domain: "analytics",
 *     hasStructuredData: true,
 *     requiresCreativity: false,
 *     hasTimeConstraint: false,
 *     riskLevel: "medium",
 *     novelty: "familiar"
 *   }
 * );
 * 
 * // Start execution
 * metaCognitivePlanner.startExecution(plan.id);
 * 
 * // Monitor cognitive state
 * cognitiveMonitor.startMonitoring("agent-1");
 * cognitiveMonitor.recordMetrics("agent-1", {
 *   processingLatencyMs: 5000,
 *   coherenceScore: 0.85,
 *   confidenceEstimate: 0.8
 * });
 * 
 * // Check for adaptation needs
 * const needsAdapt = metaCognitivePlanner.checkAdaptationNeeded(plan.id, 3, {
 *   timeSpentMs: 45000,
 *   verificationFailures: 1,
 *   confidence: 0.6
 * });
 * 
 * if (needsAdapt.adapt) {
 *   await metaCognitivePlanner.adaptPlan(plan.id, needsAdapt.suggestedStrategy!);
 * }
 * 
 * // Complete and learn
 * await metaCognitivePlanner.completePlan(plan.id, {
 *   success: true,
 *   actualSteps: 5,
 *   actualTimeMs: 60000,
 *   quality: 0.9,
 *   lessons: ["Data preprocessing was key"]
 * });
 * ```
 */

// Core services
export {
  metaCognitivePlanner,
  MetaCognitivePlannerService,
  type TaskCharacteristics,
  type AgentCognitiveState,
  type CognitivePlan,
  type StrategyPerformance,
} from "./meta-cognitive-planner.service.js";

// Cognitive monitoring
export {
  cognitiveMonitor,
  CognitiveMonitorService,
  type CognitiveMetrics,
  type CognitiveAnomaly,
  type Intervention,
} from "./cognitive-monitor.service.js";

// Reasoning strategies
export {
  STRATEGY_DEFINITIONS,
  recommendStrategies,
  type ReasoningStrategy,
  type StrategyConfig,
} from "./reasoning-strategies.js";
