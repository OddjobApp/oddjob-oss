/**
 * Causal Reasoning Module
 * 
 * Judea Pearl's causal inference for agents.
 * Do-calculus, counterfactuals, root cause analysis.
 * 
 * @example
 * ```typescript
 * import { CausalReasoningService } from './causal';
 * 
 * const service = new CausalReasoningService(eventStream);
 * 
 * // Load causal graph
 * service.loadGraph(graph);
 * 
 * // Estimate causal effect
 * const ate = await service.estimateATE(graphId, 'treatment', 'outcome', data);
 * 
 * // Compute counterfactual
 * const scenario = await service.computeCounterfactual(
 *   graphId,
 *   evidence,
 *   { target: 'marketing_spend', value: 10000 },
 *   'revenue'
 * );
 * 
 * // Root cause analysis
 * const causes = await service.analyzeRootCause(
 *   graphId,
 *   { variable: 'failure_rate', value: 0.3, expectedValue: 0.1 },
 *   context
 * );
 * ```
 */

// Types
export {
  CausalVariable,
  CausalEdge,
  CausalGraph,
  CausalQuery,
  CausalEstimate,
  CounterfactualScenario,
  RootCauseAnalysis,
  MediationAnalysis,
  DoCalculusStep,
  BackdoorPath,
  CausalConfig,
  DEFAULT_CAUSAL_CONFIG,
  CausalError,
  CausalErrorType,
  CausalMetrics
} from './types.js';

// Services
export { CausalReasoningService } from './causal-reasoning.service.js';
