/**
 * Speculative Execution Service
 * 
 * Main service for MCTS-based lookahead planning with checkpoint/rollback.
 */

import { MCTSEngine } from './mcts.engine.js';
import {
  PlanningRequest,
  PlanningResult,
  SpeculativeExecutionRequest,
  SpeculativeExecutionResult,
  SpeculativeExecutionConfig,
  DEFAULT_SPECULATIVE_CONFIG,
  Checkpoint,
  RollbackInfo,
  RollbackResult,
  RollbackStep,
  SideEffect,
  PlannedAction,
  PlanningState,
  StateSimulator,
  SpeculativeExecutionError,
  SpeculativeExecutionErrorType,
  PlanningMetrics
} from './types.js';
import { createLogger } from '../../../../utils/logger.js';
import { randomUUID } from 'crypto';

const logger = createLogger('SpeculativeExecutionService');

/**
 * Speculative Execution Service
 */
export class SpeculativeExecutionService {
  private config: SpeculativeExecutionConfig;
  private checkpoints: Map<string, Checkpoint> = new Map();
  private activeSpeculations: Map<string, SpeculativeExecutionRequest> = new Map();
  private simulator: StateSimulator;
  private metrics: PlanningMetrics;

  constructor(
    simulator: StateSimulator,
    private eventStream: EventStreamService,
    config?: Partial<SpeculativeExecutionConfig>
  ) {
    this.config = { ...DEFAULT_SPECULATIVE_CONFIG, ...config };
    this.simulator = simulator;
    this.metrics = {
      totalRequests: 0,
      successfulPlans: 0,
      failedPlans: 0,
      avgPlanningTimeMs: 0,
      avgTreeSize: 0,
      rollbackSuccessRate: 0,
      avgSpeculationAccuracy: 0
    };
    
    logger.info('Speculative Execution Service initialized', {
      enabled: this.config.enabled,
      maxDepth: this.config.defaultMCTSConfig.maxDepth
    });
  }

  /**
   * Create planning request for MCTS
   */
  async plan(request: PlanningRequest): Promise<PlanningResult> {
    if (!this.config.enabled) {
      logger.warn('Speculative execution disabled, returning empty plan');
      return this.createEmptyResult(request.id);
    }

    logger.info(`[${request.id}] Starting planning for goal: ${request.goal}`);

    try {
      // Create MCTS engine with request-specific config
      const mctsConfig = {
        ...this.config.defaultMCTSConfig,
        ...request.mctsConfig
      };
      const mcts = new MCTSEngine(this.simulator, mctsConfig);

      // Run planning
      const result = await mcts.plan(
        request.initialState,
        request.goal,
        request.availableActions,
        request.predictions
      );

      // Update metrics
      this.updateMetrics(result, true);

      logger.info(`[${request.id}] Planning complete: ${result.bestPlan.length} actions, value: ${result.expectedValue.toFixed(3)}`);

      return result;

    } catch (error) {
      logger.error(`[${request.id}] Planning failed:`, error);
      this.updateMetrics(null, false);
      throw new SpeculativeExecutionError(
        SpeculativeExecutionErrorType.PLANNING_FAILED,
        `Planning failed: ${(error as Error).message}`,
        request.id,
        error as Error
      );
    }
  }

  /**
   * Speculatively execute an action with rollback capability
   */
  async speculate(
    request: SpeculativeExecutionRequest
  ): Promise<SpeculativeExecutionResult> {
    const requestId = request.id;
    
    logger.info(`[${requestId}] Starting speculative execution for action: ${request.action.id}`);

    try {
      // Check concurrent limit
      if (this.activeSpeculations.size >= this.config.maxConcurrentSpeculations) {
        throw new SpeculativeExecutionError(
          SpeculativeExecutionErrorType.TIMEOUT,
          'Maximum concurrent speculations reached'
        );
      }

      this.activeSpeculations.set(requestId, request);

      // Emit event
      await this.eventStream.publish({
        type: 'speculative.speculation_started',
        payload: { requestId, actionId: request.action.id }
      });

      // Create checkpoint if rollback enabled
      let checkpoint: Checkpoint | null = null;
      if (request.enableRollback) {
        checkpoint = await this.createCheckpoint(
          request.agentId,
          request.missionId,
          request.currentState
        );
      }

      // Simulate action execution
      const initialState: PlanningState = {
        id: 'initial',
        description: 'Initial state for speculation',
        context: request.currentState,
        parentId: null,
        depth: 0,
        isTerminal: false,
        value: 0,
        visits: 0,
        totalReward: 0
      };

      const resultingState = await this.simulator.simulate(
        initialState,
        request.action
      );

      // Analyze side effects
      const sideEffects = this.detectSideEffects(
        request.currentState,
        resultingState.context
      );

      // Evaluate outcome
      const valueEstimate = await this.simulator.evaluate(resultingState);

      // Determine recommendation
      const recommendExecution = this.shouldRecommendExecution(
        valueEstimate,
        sideEffects,
        request.action
      );

      // Build rollback info if checkpoint exists
      const rollbackInfo: RollbackInfo | undefined = checkpoint ? {
        checkpointId: checkpoint.id,
        rollbackSteps: sideEffects
          .filter(e => e.reversible)
          .map((e, i) => ({
            order: i,
            action: request.action,
            reversal: e.reversalAction!,
            success: true
          })),
        stateSnapshot: checkpoint.state,
        actionsToUndo: [request.action],
        estimatedRollbackTimeMs: this.estimateRollbackTime(sideEffects)
      } : undefined;

      const result: SpeculativeExecutionResult = {
        requestId,
        success: true,
        resultingState: resultingState.context,
        outcome: this.generateOutcomeDescription(resultingState, sideEffects),
        sideEffects,
        valueEstimate,
        recommendExecution,
        rollbackInfo
      };

      // Update metrics
      this.metrics.avgSpeculationAccuracy = 
        (this.metrics.avgSpeculationAccuracy * this.metrics.totalRequests + valueEstimate) 
        / (this.metrics.totalRequests + 1);

      // Emit event
      await this.eventStream.publish({
        type: 'speculative.speculation_completed',
        payload: { 
          requestId, 
          success: true, 
          recommend: recommendExecution 
        }
      });

      logger.info(`[${requestId}] Speculation complete: recommend=${recommendExecution}, value=${valueEstimate.toFixed(3)}`);

      this.activeSpeculations.delete(requestId);
      return result;

    } catch (error) {
      logger.error(`[${requestId}] Speculation failed:`, error);
      this.activeSpeculations.delete(requestId);
      
      throw new SpeculativeExecutionError(
        SpeculativeExecutionErrorType.SIMULATION_FAILED,
        `Speculative execution failed: ${(error as Error).message}`,
        requestId,
        error as Error
      );
    }
  }

  /**
   * Rollback to checkpoint
   */
  async rollback(checkpointId: string): Promise<RollbackResult> {
    logger.info(`[${checkpointId}] Starting rollback`);

    const checkpoint = this.checkpoints.get(checkpointId);
    
    if (!checkpoint) {
      throw new SpeculativeExecutionError(
        SpeculativeExecutionErrorType.CHECKPOINT_NOT_FOUND,
        `Checkpoint ${checkpointId} not found`
      );
    }

    if (checkpoint.expiresAt && checkpoint.expiresAt < new Date()) {
      throw new SpeculativeExecutionError(
        SpeculativeExecutionErrorType.CHECKPOINT_EXPIRED,
        `Checkpoint ${checkpointId} has expired`
      );
    }

    try {
      // Emit event
      await this.eventStream.publish({
        type: 'speculative.rollback_started',
        payload: { checkpointId, steps: checkpoint.actionHistory.length }
      });

      const startTime = Date.now();

      // Reverse actions in reverse order
      const steps: RollbackStep[] = [];
      let allSuccess = true;

      for (let i = checkpoint.actionHistory.length - 1; i >= 0; i--) {
        const action = checkpoint.actionHistory[i];
        
        // Create reversal action (placeholder - would need actual reversal logic)
        const reversal: PlannedAction = {
          id: `rollback-${action.id}`,
          type: 'rollback',
          description: `Undo: ${action.description}`,
          parameters: { originalAction: action },
          expectedOutcome: 'State restored to pre-action',
          cost: 0.5,
          successProbability: 0.95
        };

        try {
          // Execute reversal (placeholder)
          logger.debug(`Rolling back action: ${action.id}`);
          
          steps.push({
            order: steps.length,
            action,
            reversal,
            success: true
          });
        } catch (error) {
          allSuccess = false;
          steps.push({
            order: steps.length,
            action,
            reversal,
            success: false,
            error: (error as Error).message
          });
        }
      }

      const rollbackTimeMs = Date.now() - startTime;

      // Update metrics
      const rollbackSuccess = steps.filter(s => s.success).length / steps.length;
      this.metrics.rollbackSuccessRate = 
        (this.metrics.rollbackSuccessRate * this.metrics.totalRequests + rollbackSuccess)
        / (this.metrics.totalRequests + 1);

      const result: RollbackResult = {
        success: allSuccess,
        stepsCompleted: steps.filter(s => s.success).length,
        totalSteps: steps.length,
        restoredState: checkpoint.state,
        failedSteps: steps.filter(s => !s.success),
        rollbackTimeMs
      };

      // Emit event
      await this.eventStream.publish({
        type: 'speculative.rollback_completed',
        payload: { checkpointId, success: allSuccess }
      });

      logger.info(`[${checkpointId}] Rollback complete: ${result.stepsCompleted}/${result.totalSteps} steps`);

      return result;

    } catch (error) {
      logger.error(`[${checkpointId}] Rollback failed:`, error);
      throw new SpeculativeExecutionError(
        SpeculativeExecutionErrorType.ROLLBACK_FAILED,
        `Rollback failed: ${(error as Error).message}`,
        undefined,
        error as Error
      );
    }
  }

  /**
   * Create checkpoint
   */
  async createCheckpoint(
    agentId: string,
    missionId: string,
    state: Record<string, any>,
    actionHistory?: PlannedAction[]
  ): Promise<Checkpoint> {
    const checkpointId = randomUUID();
    
    const checkpoint: Checkpoint = {
      id: checkpointId,
      agentId,
      missionId,
      state: JSON.parse(JSON.stringify(state)),  // Deep copy
      actionHistory: actionHistory || [],
      resources: {},  // Would capture actual resources
      externalState: {},  // Would capture DB/API state
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.checkpointTtlMs)
    };

    this.checkpoints.set(checkpointId, checkpoint);

    // Emit event
    await this.eventStream.publish({
      type: 'speculative.checkpoint_created',
      payload: { checkpointId, agentId }
    });

    logger.info(`[${checkpointId}] Checkpoint created for agent ${agentId}`);

    return checkpoint;
  }

  /**
   * Get checkpoint by ID
   */
  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    return this.checkpoints.get(checkpointId);
  }

  /**
   * Get checkpoints for agent
   */
  getCheckpointsForAgent(agentId: string): Checkpoint[] {
    return Array.from(this.checkpoints.values())
      .filter(c => c.agentId === agentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Delete checkpoint
   */
  deleteCheckpoint(checkpointId: string): boolean {
    const deleted = this.checkpoints.delete(checkpointId);
    if (deleted) {
      logger.info(`[${checkpointId}] Checkpoint deleted`);
    }
    return deleted;
  }

  /**
   * Clean up expired checkpoints
   */
  cleanupExpiredCheckpoints(): number {
    const now = new Date();
    let deleted = 0;

    for (const [id, checkpoint] of this.checkpoints) {
      if (checkpoint.expiresAt && checkpoint.expiresAt < now) {
        this.checkpoints.delete(id);
        deleted++;
      }
    }

    if (deleted > 0) {
      logger.info(`Cleaned up ${deleted} expired checkpoints`);
    }

    return deleted;
  }

  /**
   * Get service metrics
   */
  getMetrics(): PlanningMetrics {
    return { ...this.metrics };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SpeculativeExecutionConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Speculative execution config updated', config);
  }

  /**
   * Detect side effects from state change
   */
  private detectSideEffects(
    before: Record<string, any>,
    after: Record<string, any>
  ): SideEffect[] {
    const effects: SideEffect[] = [];

    for (const key of Object.keys(after)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        const reversible = typeof after[key] !== 'undefined';  // Simplified check
        
        effects.push({
          type: 'state_change',
          description: `State change: ${key}`,
          resource: key,
          before: before[key],
          after: after[key],
          reversible,
          reversalAction: reversible ? {
            id: `restore-${key}`,
            type: 'state_restore',
            description: `Restore ${key} to original value`,
            parameters: { key, value: before[key] },
            expectedOutcome: `Value of ${key} restored`,
            cost: 0.1,
            successProbability: 0.99
          } : undefined
        });
      }
    }

    return effects;
  }

  /**
   * Determine if execution should be recommended
   */
  private shouldRecommendExecution(
    valueEstimate: number,
    sideEffects: SideEffect[],
    action: PlannedAction
  ): boolean {
    // Positive value estimate
    if (valueEstimate <= 0) {
      return false;
    }

    // Not too many irreversible side effects
    const irreversibleCount = sideEffects.filter(e => !e.reversible).length;
    if (irreversibleCount > 3) {
      return false;
    }

    // Reasonable cost
    if (action.cost > 10) {  // Arbitrary threshold
      return false;
    }

    return true;
  }

  /**
   * Generate outcome description
   */
  private generateOutcomeDescription(
    state: PlanningState,
    sideEffects: SideEffect[]
  ): string {
    const parts: string[] = [];
    
    parts.push(`State changed with value estimate: ${state.value.toFixed(3)}`);
    
    if (sideEffects.length > 0) {
      parts.push(`${sideEffects.length} side effects detected:`);
      for (const effect of sideEffects) {
        parts.push(`  - ${effect.description} (${effect.reversible ? 'reversible' : 'irreversible'})`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Estimate rollback time
   */
  private estimateRollbackTime(sideEffects: SideEffect[]): number {
    const reversibleEffects = sideEffects.filter(e => e.reversible).length;
    return reversibleEffects * 100;  // 100ms per effect estimate
  }

  /**
   * Update metrics
   */
  private updateMetrics(result: PlanningResult | null, success: boolean): void {
    this.metrics.totalRequests++;

    if (success && result) {
      this.metrics.successfulPlans++;
      
      // Update averages
      this.metrics.avgPlanningTimeMs = 
        (this.metrics.avgPlanningTimeMs * (this.metrics.totalRequests - 1) + result.planningTimeMs)
        / this.metrics.totalRequests;
      
      this.metrics.avgTreeSize = 
        (this.metrics.avgTreeSize * (this.metrics.totalRequests - 1) + result.statesExplored)
        / this.metrics.totalRequests;
    } else {
      this.metrics.failedPlans++;
    }
  }

  /**
   * Create empty planning result
   */
  private createEmptyResult(requestId: string): PlanningResult {
    return {
      requestId,
      bestPlan: [],
      expectedValue: 0,
      successProbability: 0,
      expectedCost: 0,
      alternativePlans: [],
      treeStats: {
        totalNodes: 0,
        maxDepth: 0,
        avgBranchingFactor: 0,
        terminalNodes: 0,
        totalSimulations: 0
      },
      planningTimeMs: 0,
      statesExplored: 0,
      confidence: 0
    };
  }
}

/**
 * Event Stream Service Interface
 */
interface EventStreamService {
  publish(event: { type: string; payload: any }): Promise<void>;
}
