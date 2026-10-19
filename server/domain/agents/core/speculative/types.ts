/**
 * Speculative Execution - Types and Interfaces
 * 
 * Monte Carlo Tree Search (MCTS) lookahead planning for agents.
 * Enables agents to simulate outcomes before acting.
 */

/**
 * State in the planning tree
 */
export interface PlanningState {
  /** State ID */
  id: string;
  
  /** State description */
  description: string;
  
  /** Current context/state representation */
  context: Record<string, any>;
  
  /** Parent state ID (null for root) */
  parentId: string | null;
  
  /** Action that led to this state */
  incomingAction?: PlannedAction;
  
  /** Depth in tree */
  depth: number;
  
  /** Is terminal state */
  isTerminal: boolean;
  
  /** State value estimate (-1 to 1) */
  value: number;
  
  /** Visit count for MCTS */
  visits: number;
  
  /** Total reward accumulated */
  totalReward: number;
}

/**
 * Planned Action
 */
export interface PlannedAction {
  /** Action ID */
  id: string;
  
  /** Action type */
  type: string;
  
  /** Action description */
  description: string;
  
  /** Action parameters */
  parameters: Record<string, any>;
  
  /** Expected outcome description */
  expectedOutcome: string;
  
  /** Action cost (resource, time, etc) */
  cost: number;
  
  /** Precondition check */
  preconditions?: string[];
  
  /** Success probability estimate (0-1) */
  successProbability: number;

  /** Risk level */
  risk?: "low" | "medium" | "high";
  
  /** Action status */
  status?: "pending" | "alerting" | "executing" | "verifying" | "completed" | "failed";
  
  /** Verification tool */
  verificationTool?: string;
}

/**
 * State-Action Node in MCTS tree
 */
export interface MCTSNode {
  /** Node ID */
  id: string;
  
  /** Associated state */
  state: PlanningState;
  
  /** Available actions from this state */
  availableActions: PlannedAction[];
  
  /** Child nodes (action -> new state) */
  children: Map<string, MCTSNode>;  // actionId -> child node
  
  /** Visits count */
  visits: number;
  
  /** Total value/reward */
  totalValue: number;
  
  /** UCB1 score for selection */
  ucb1Score: number;
  
  /** Is fully expanded */
  isFullyExpanded: boolean;
  
  /** Untried actions */
  untriedActions: PlannedAction[];
}

/**
 * Simulation Result
 */
export interface SimulationResult {
  /** Final state reached */
  finalState: PlanningState;
  
  /** Sequence of actions taken */
  actionSequence: PlannedAction[];
  
  /** Total reward accumulated */
  totalReward: number;
  
  /** Steps taken */
  steps: number;
  
  /** Terminal reason */
  terminalReason: 'goal_reached' | 'max_depth' | 'dead_end' | 'failure';
  
  /** Simulation trajectory for analysis */
  trajectory: PlanningState[];
}

/**
 * MCTS Configuration
 */
export interface MCTSConfig {
  /** Number of iterations */
  iterations: number;
  
  /** Maximum tree depth */
  maxDepth: number;
  
  /** Exploration constant (C in UCB1) */
  explorationConstant: number;
  
  /** Discount factor for rewards */
  discountFactor: number;
  
  /** Time limit per search (ms) */
  timeLimitMs: number;
  
  /** Number of simulations per evaluation */
  rolloutCount: number;
  
  /** Enable parallel simulations */
  parallel: boolean;
  
  /** Max parallel workers */
  maxParallelWorkers: number;
}

/**
 * Default MCTS configuration
 */
export const DEFAULT_MCTS_CONFIG: MCTSConfig = {
  iterations: 10,
  maxDepth: 10,
  explorationConstant: 1.414,  // sqrt(2)
  discountFactor: 0.95,
  timeLimitMs: 5000,
  rolloutCount: 1,
  parallel: true,
  maxParallelWorkers: 4
};

/**
 * Planning Request
 */
export interface PlanningRequest {
  /** Request ID */
  id: string;
  
  /** Initial state description */
  initialState: PlanningState;
  
  /** Goal description */
  goal: string;
  
  /** Available action types */
  availableActions: string[];
  
  /** Constraints */
  constraints?: {
    maxSteps?: number;
    maxCost?: number;
    forbiddenActions?: string[];
    requiredActions?: string[];
  };
  
  /** Planning horizon */
  horizon: 'immediate' | 'short' | 'medium' | 'long';
  
  /** Success criteria */
  successCriteria: string;
  
  /** MCTS configuration override */
  mctsConfig?: Partial<MCTSConfig>;

  /** Predictions from prediction engine */
  predictions?: { suggestedSources: string[]; priorityKeywords: string[] };
}

/**
 * Planning Result
 */
export interface PlanningResult {
  /** Request ID */
  requestId: string;
  
  /** Best action sequence found */
  bestPlan: PlannedAction[];
  
  /** Expected value of plan */
  expectedValue: number;
  
  /** Success probability */
  successProbability: number;
  
  /** Expected cost */
  expectedCost: number;
  
  /** Alternative plans */
  alternativePlans: AlternativePlan[];
  
  /** Planning tree statistics */
  treeStats: TreeStatistics;
  
  /** Planning time (ms) */
  planningTimeMs: number;
  
  /** Number of states explored */
  statesExplored: number;
  
  /** Confidence in plan */
  confidence: number;
}

/**
 * Alternative Plan
 */
export interface AlternativePlan {
  /** Plan ID */
  id: string;
  
  /** Action sequence */
  actions: PlannedAction[];
  
  /** Expected value */
  expectedValue: number;
  
  /** Success probability */
  successProbability: number;
  
  /** Why this is alternative */
  rationale: string;
}

/**
 * Tree Statistics
 */
export interface TreeStatistics {
  /** Total nodes in tree */
  totalNodes: number;
  
  /** Maximum depth reached */
  maxDepth: number;
  
  /** Average branching factor */
  avgBranchingFactor: number;
  
  /** Terminal nodes count */
  terminalNodes: number;
  
  /** Total simulations run */
  totalSimulations: number;
}

/**
 * Speculative Execution Request
 */
export interface SpeculativeExecutionRequest {
  /** Request ID */
  id: string;
  
  /** Agent ID */
  agentId: string;
  
  /** Mission ID */
  missionId: string;
  
  /** Organization ID */
  organizationId: number;
  
  /** Current state snapshot */
  currentState: Record<string, any>;
  
  /** Action to speculatively execute */
  action: PlannedAction;
  
  /** Rollback checkpoint ID */
  checkpointId?: string;
  
  /** Depth of speculation */
  speculationDepth: number;
  
  /** Enable rollback */
  enableRollback: boolean;
}

/**
 * Speculative Execution Result
 */
export interface SpeculativeExecutionResult {
  /** Request ID */
  requestId: string;
  
  /** Speculation successful */
  success: boolean;
  
  /** State after execution */
  resultingState: Record<string, any>;
  
  /** Outcome description */
  outcome: string;
  
  /** Side effects */
  sideEffects: SideEffect[];
  
  /** Value estimate (-1 to 1) */
  valueEstimate: number;
  
  /** Should execute for real */
  recommendExecution: boolean;
  
  /** Rollback info if needed */
  rollbackInfo?: RollbackInfo;
  
  /** Follow-up actions recommended */
  followUpActions?: PlannedAction[];
}

/**
 * Side Effect
 */
export interface SideEffect {
  /** Effect type */
  type: 'state_change' | 'resource_usage' | 'external_call' | 'data_mutation' | 'notification';
  
  /** Effect description */
  description: string;
  
  /** Resource affected */
  resource?: string;
  
  /** Before value */
  before?: any;
  
  /** After value */
  after?: any;
  
  /** Is reversible */
  reversible: boolean;
  
  /** Reversal action */
  reversalAction?: PlannedAction;
}

/**
 * Rollback Information
 */
export interface RollbackInfo {
  /** Checkpoint ID to restore */
  checkpointId: string;
  
  /** Rollback steps */
  rollbackSteps: RollbackStep[];
  
  /** Data to restore */
  stateSnapshot: Record<string, any>;
  
  /** Actions to undo */
  actionsToUndo: PlannedAction[];
  
  /** Estimated rollback time (ms) */
  estimatedRollbackTimeMs: number;
}

/**
 * Rollback Step
 */
export interface RollbackStep {
  /** Step order */
  order: number;
  
  /** Action to undo */
  action: PlannedAction;
  
  /** Reversal action */
  reversal: PlannedAction;
  
  /** Success status */
  success: boolean;
  
  /** Error if failed */
  error?: string;
}

/**
 * Rollback Result
 */
export interface RollbackResult {
  /** Success status */
  success: boolean;
  
  /** Steps completed */
  stepsCompleted: number;
  
  /** Total steps */
  totalSteps: number;
  
  /** State restored */
  restoredState: Record<string, any>;
  
  /** Failed steps */
  failedSteps?: RollbackStep[];
  
  /** Rollback time (ms) */
  rollbackTimeMs: number;
}

/**
 * Checkpoint
 */
export interface Checkpoint {
  /** Checkpoint ID */
  id: string;
  
  /** Agent ID */
  agentId: string;
  
  /** Mission ID */
  missionId: string;
  
  /** State at checkpoint */
  state: Record<string, any>;
  
  /** Action history up to checkpoint */
  actionHistory: PlannedAction[];
  
  /** Resources held */
  resources: Record<string, any>;
  
  /** External state (DB, APIs) */
  externalState: Record<string, any>;
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Expires at */
  expiresAt?: Date;
}

/**
 * State Simulator Interface
 */
export interface StateSimulator {
  /** Simulate action execution */
  simulate(
    state: PlanningState,
    action: PlannedAction
  ): Promise<PlanningState>;
  
  /** Evaluate state value */
  evaluate(state: PlanningState): Promise<number>;
  
  /** Check if state is terminal */
  isTerminal(state: PlanningState): Promise<boolean>;
  
  /** Get available actions */
  getAvailableActions(state: PlanningState): Promise<PlannedAction[]>;
}

/**
 * Speculative Execution Service Configuration
 */
export interface SpeculativeExecutionConfig {
  /** Enable speculative execution */
  enabled: boolean;
  
  /** Default MCTS config */
  defaultMCTSConfig: MCTSConfig;
  
  /** Max concurrent speculations */
  maxConcurrentSpeculations: number;
  
  /** Checkpoint TTL (ms) */
  checkpointTtlMs: number;
  
  /** Enable automatic rollback on failure */
  autoRollback: boolean;
  
  /** Rollback timeout (ms) */
  rollbackTimeoutMs: number;
  
  /** Enable parallel planning */
  parallelPlanning: boolean;
  
  /** Max planning workers */
  maxPlanningWorkers: number;
}

/**
 * Default configuration
 */
export const DEFAULT_SPECULATIVE_CONFIG: SpeculativeExecutionConfig = {
  enabled: true,
  defaultMCTSConfig: DEFAULT_MCTS_CONFIG,
  maxConcurrentSpeculations: 5,
  checkpointTtlMs: 3600000,  // 1 hour
  autoRollback: true,
  rollbackTimeoutMs: 30000,
  parallelPlanning: true,
  maxPlanningWorkers: 4
};

/**
 * Planning Metrics
 */
export interface PlanningMetrics {
  /** Total planning requests */
  totalRequests: number;
  
  /** Successful plans */
  successfulPlans: number;
  
  /** Failed plans */
  failedPlans: number;
  
  /** Average planning time (ms) */
  avgPlanningTimeMs: number;
  
  /** Average tree size */
  avgTreeSize: number;
  
  /** Rollback success rate */
  rollbackSuccessRate: number;
  
  /** Average speculation accuracy */
  avgSpeculationAccuracy: number;
}

/**
 * Speculative Execution Events
 */
export type SpeculativeExecutionEvent =
  | { type: 'speculative.planning_started'; payload: { requestId: string; agentId: string } }
  | { type: 'speculative.planning_completed'; payload: { requestId: string; planFound: boolean; value: number } }
  | { type: 'speculative.speculation_started'; payload: { requestId: string; actionId: string } }
  | { type: 'speculative.speculation_completed'; payload: { requestId: string; success: boolean; recommend: boolean } }
  | { type: 'speculative.rollback_started'; payload: { checkpointId: string; steps: number } }
  | { type: 'speculative.rollback_completed'; payload: { checkpointId: string; success: boolean } }
  | { type: 'speculative.checkpoint_created'; payload: { checkpointId: string; agentId: string } };

/**
 * Error types
 */
export enum SpeculativeExecutionErrorType {
  PLANNING_FAILED = 'planning_failed',
  SIMULATION_FAILED = 'simulation_failed',
  ROLLBACK_FAILED = 'rollback_failed',
  CHECKPOINT_NOT_FOUND = 'checkpoint_not_found',
  CHECKPOINT_EXPIRED = 'checkpoint_expired',
  MAX_DEPTH_REACHED = 'max_depth_reached',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

/**
 * Speculative Execution Error
 */
export class SpeculativeExecutionError extends Error {
  constructor(
    public type: SpeculativeExecutionErrorType,
    message: string,
    public requestId?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'SpeculativeExecutionError';
  }
}

/**
 * Action Outcome Prediction
 */
export interface ActionOutcomePrediction {
  /** Action being predicted */
  action: PlannedAction;
  
  /** Predicted success probability */
  successProbability: number;
  
  /** Predicted state changes */
  predictedChanges: StateChange[];
  
  /** Predicted side effects */
  predictedSideEffects: SideEffect[];
  
  /** Confidence in prediction (0-1) */
  confidence: number;
  
  /** Prediction basis */
  basis: 'historical' | 'simulation' | 'heuristic' | 'hybrid';
}

/**
 * State Change
 */
export interface StateChange {
  /** Field changed */
  field: string;
  
  /** Old value */
  oldValue: any;
  
  /** New value */
  newValue: any;
  
  /** Change type */
  type: 'set' | 'increment' | 'decrement' | 'append' | 'remove';
}
