/**
 * Speculative Execution Module
 * 
 * MCTS lookahead planning with checkpoint/rollback.
 */

// Types
export {
  PlanningState,
  PlannedAction,
  MCTSNode,
  SimulationResult,
  MCTSConfig,
  DEFAULT_MCTS_CONFIG,
  PlanningRequest,
  PlanningResult,
  AlternativePlan,
  TreeStatistics,
  SpeculativeExecutionRequest,
  SpeculativeExecutionResult,
  SideEffect,
  RollbackInfo,
  RollbackResult,
  RollbackStep,
  Checkpoint,
  StateSimulator,
  SpeculativeExecutionConfig,
  DEFAULT_SPECULATIVE_CONFIG,
  PlanningMetrics,
  SpeculativeExecutionError,
  SpeculativeExecutionErrorType,
  ActionOutcomePrediction
} from './types.js';

// Services
export { MCTSEngine } from './mcts.engine.js';
export { SpeculativeExecutionService } from './speculative-execution.service.js';
