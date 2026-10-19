/**
 * MCTS (Monte Carlo Tree Search) Engine
 * 
 * Core planning algorithm for speculative execution.
 * Implements UCB1 selection, expansion, simulation, and backpropagation.
 */

import {
  PlanningState,
  PlannedAction,
  MCTSNode,
  SimulationResult,
  MCTSConfig,
  DEFAULT_MCTS_CONFIG,
  PlanningResult,
  TreeStatistics,
  AlternativePlan,
  StateSimulator,
  SpeculativeExecutionError,
  SpeculativeExecutionErrorType
} from './types.js';
import { createLogger } from '../../../../utils/logger.js';
import { randomUUID } from 'crypto';

const logger = createLogger('MCTSEngine');

/**
 * MCTS Engine
 */
export class MCTSEngine {
  private config: MCTSConfig;
  private simulator: StateSimulator;
  private rootNode: MCTSNode | null = null;
  private nodeCounter = 0;
  private currentPredictions?: { suggestedSources: string[]; priorityKeywords: string[] };

  constructor(
    simulator: StateSimulator,
    config?: Partial<MCTSConfig>
  ) {
    this.config = { ...DEFAULT_MCTS_CONFIG, ...config };
    this.simulator = simulator;
    logger.info('MCTS Engine initialized', {
      iterations: this.config.iterations,
      maxDepth: this.config.maxDepth
    });
  }

  /**
   * Run MCTS planning from initial state
   */
  async plan(
    initialState: PlanningState,
    goal: string,
    availableActions: string[],
    predictions?: { suggestedSources: string[]; priorityKeywords: string[] }
  ): Promise<PlanningResult> {
    this.currentPredictions = predictions;
    const startTime = Date.now();
    const requestId = randomUUID();
    
    logger.info(`[${requestId}] Starting MCTS planning: ${this.config.iterations} iterations`);

    try {
      // Initialize root node
      this.rootNode = await this.createRootNode(initialState, availableActions);
      
      let iterations = 0;
      const startIterationTime = Date.now();

      // Main MCTS loop
      while (iterations < this.config.iterations &&
             (Date.now() - startIterationTime) < this.config.timeLimitMs) {
        
        // 1. Selection: Select node to expand using UCB1
        const selectedNode = this.select(this.rootNode);

        // 2. Expansion: Expand selected node
        const expandedNode = await this.expand(selectedNode);

        // 3. Simulation: Run rollout from expanded node
        const simulationResult = await this.simulate(expandedNode, goal);

        // 4. Backpropagation: Update values up the tree
        this.backpropagate(expandedNode, simulationResult.totalReward);

        iterations++;
      }

      // Extract best plan
      const bestPlan = this.extractBestPlan(this.rootNode);
      const alternativePlans = this.extractAlternativePlans(this.rootNode, 3);
      
      // Calculate statistics
      const treeStats = this.calculateTreeStats(this.rootNode);
      const statesExplored = this.countNodes(this.rootNode);

      const planningTimeMs = Date.now() - startTime;

      // Calculate expected values
      const expectedValue = bestPlan.length > 0
        ? this.rootNode.children.get(bestPlan[0].id)?.totalValue || 0
        : 0;

      const successProbability = this.estimateSuccessProbability(
        this.rootNode,
        bestPlan
      );

      const expectedCost = bestPlan.reduce((sum, action) => sum + action.cost, 0);

      const result: PlanningResult = {
        requestId,
        bestPlan,
        expectedValue,
        successProbability,
        expectedCost,
        alternativePlans,
        treeStats,
        planningTimeMs,
        statesExplored,
        confidence: Math.min(treeStats.totalSimulations / 100, 0.95)
      };

      logger.info(`[${requestId}] Planning complete: ${iterations} iterations, ${planningTimeMs}ms, value: ${expectedValue.toFixed(3)}`);

      return result;

    } catch (error) {
      logger.error(`[${requestId}] Planning failed:`, error);
      throw new SpeculativeExecutionError(
        SpeculativeExecutionErrorType.PLANNING_FAILED,
        `MCTS planning failed: ${(error as Error).message}`,
        requestId,
        error as Error
      );
    }
  }

  /**
   * UCB1 Selection - Select node to expand
   */
  private select(node: MCTSNode): MCTSNode {
    // If node has untried actions, return it for expansion
    if (node.untriedActions.length > 0) {
      return node;
    }

    // If terminal, return it
    if (node.state.isTerminal || node.state.depth >= this.config.maxDepth) {
      return node;
    }

    // Select child with highest UCB1 score
    let bestChild: MCTSNode | null = null;
    let bestScore = -Infinity;

    for (const child of node.children.values()) {
      const score = this.calculateUCB1(child, node.visits);
      child.ucb1Score = score;

      if (score > bestScore) {
        bestScore = score;
        bestChild = child;
      }
    }

    // Recursively select
    if (bestChild) {
      return this.select(bestChild);
    }

    return node;
  }

  /**
   * Calculate UCB1 score
   */
  private calculateUCB1(node: MCTSNode, parentVisits: number): number {
    if (node.visits === 0) {
      return Infinity;  // Encourage exploration of unvisited nodes
    }

    const exploitation = node.totalValue / node.visits;
    const exploration = this.config.explorationConstant * 
      Math.sqrt(Math.log(parentVisits) / node.visits);

    return exploitation + exploration;
  }

  /**
   * Expand node by trying an untried action
   */
  private async expand(node: MCTSNode): Promise<MCTSNode> {
    // If already fully expanded, return node
    if (node.untriedActions.length === 0) {
      return node;
    }

    // Pick action based on predictions (Guided Expansion)
    let actionIndex = 0;
    if (this.currentPredictions && node.untriedActions.length > 1) {
        let bestScore = -1;
        for (let i = 0; i < node.untriedActions.length; i++) {
            const action = node.untriedActions[i];
            let score = 0;
            if (this.currentPredictions.suggestedSources.some(s => action.type.includes(s) || s.includes(action.type))) {
                score += 10;
            }
            if (this.currentPredictions.priorityKeywords.some(k => action.description.includes(k) || action.type.includes(k))) {
                score += 5;
            }
            if (score > bestScore) {
                bestScore = score;
                actionIndex = i;
            }
        }
        if (bestScore === 0) {
            actionIndex = Math.floor(Math.random() * node.untriedActions.length);
        }
    } else {
        actionIndex = Math.floor(Math.random() * node.untriedActions.length);
    }
    const action = node.untriedActions.splice(actionIndex, 1)[0];

    // Simulate action
    try {
      const newState = await this.simulator.simulate(node.state, action);
      
      // Get available actions for new state
      const availableActions = await this.simulator.getAvailableActions(newState);

      // Create child node
      const childNode = this.createNode(newState, availableActions, node);
      node.children.set(action.id, childNode);

      // Mark as fully expanded if no more untried actions
      if (node.untriedActions.length === 0) {
        node.isFullyExpanded = true;
      }

      return childNode;

    } catch (error) {
      logger.error(`Expansion failed for action: ${action.id}`, { error });
      // Continue with node itself if expansion fails
      return node;
    }
  }

  /**
   * Simulate (rollout) from node to terminal
   */
  private async simulate(node: MCTSNode, goal: string): Promise<SimulationResult> {
    const actionSequence: PlannedAction[] = [];
    const trajectory: PlanningState[] = [node.state];
    
    let currentState = node.state;
    let totalReward = 0;
    let steps = 0;

    // Rollout until terminal or max depth
    while (steps < (this.config.maxDepth - node.state.depth)) {
      // Check if terminal
      if (await this.simulator.isTerminal(currentState)) {
        break;
      }

      // Get available actions
      const actions = await this.simulator.getAvailableActions(currentState);
      
      if (actions.length === 0) {
        break;
      }

      // Select best action based on predictions (guided rollout)
      const action = this.selectBestAction(actions);
      actionSequence.push(action);

      // Simulate action
      try {
        currentState = await this.simulator.simulate(currentState, action);
        trajectory.push(currentState);

        // Accumulate discounted reward
        const reward = await this.simulator.evaluate(currentState);
        totalReward += Math.pow(this.config.discountFactor, steps) * reward;

        steps++;
      } catch (error) {
        // Simulation failed, treat as bad outcome
        totalReward -= 1;
        break;
      }
    }

    // Determine terminal reason
    let terminalReason: SimulationResult['terminalReason'] = 'max_depth';
    if (await this.simulator.isTerminal(currentState)) {
      terminalReason = 'goal_reached';
    } else if (steps === 0) {
      terminalReason = 'dead_end';
    }

    return {
      finalState: currentState,
      actionSequence,
      totalReward,
      steps,
      terminalReason,
      trajectory
    };
  }

  /**
   * Backpropagate reward up the tree
   */
  private backpropagate(node: MCTSNode, reward: number): void {
    let current: MCTSNode | null = node;
    
    while (current) {
      current.visits++;
      current.totalValue += reward;
      current = this.findParent(current);
    }
  }

  /**
   * Find parent of a node (inefficient but works for now)
   */
  private findParent(node: MCTSNode): MCTSNode | null {
    if (!this.rootNode || node === this.rootNode) {
      return null;
    }

    return this.findParentRecursive(this.rootNode, node);
  }

  private findParentRecursive(parent: MCTSNode, target: MCTSNode): MCTSNode | null {
    for (const child of parent.children.values()) {
      if (child === target) {
        return parent;
      }
      
      const found = this.findParentRecursive(child, target);
      if (found) {
        return found;
      }
    }
    
    return null;
  }

  /**
   * Extract best plan from tree
   */
  private extractBestPlan(root: MCTSNode): PlannedAction[] {
    const plan: PlannedAction[] = [];
    let current: MCTSNode = root;

    while (current.children.size > 0) {
      // Find best child
      let bestChild: MCTSNode | null = null;
      let bestValue = -Infinity;
      let bestActionId = '';

      for (const [actionId, child] of current.children) {
        const avgValue = child.visits > 0 ? child.totalValue / child.visits : -Infinity;
        if (avgValue > bestValue) {
          bestValue = avgValue;
          bestChild = child;
          bestActionId = actionId;
        }
      }

      if (!bestChild) break;

      // Find action that leads to best child
      const action = current.availableActions.find(a => a.id === bestActionId);
      if (action) {
        plan.push(action);
      }

      current = bestChild;
    }

    return plan;
  }

  /**
   * Extract alternative plans
   */
  private extractAlternativePlans(root: MCTSNode, count: number): AlternativePlan[] {
    const alternatives: AlternativePlan[] = [];

    // Get children sorted by value
    const children = Array.from(root.children.entries())
      .map(([actionId, node]) => ({
        actionId,
        node,
        value: node.visits > 0 ? node.totalValue / node.visits : -Infinity
      }))
      .sort((a, b) => b.value - a.value)
      .slice(1, count + 1);  // Skip best, take next best

    for (const { actionId, node, value } of children) {
      const action = root.availableActions.find(a => a.id === actionId);
      if (!action) continue;

      const subPlan = this.extractBestPlan(node);
      
      alternatives.push({
        id: randomUUID(),
        actions: [action, ...subPlan],
        expectedValue: value,
        successProbability: this.estimateSuccessProbability(root, [action]),
        rationale: `Alternative starting with: ${action.description}`
      });
    }

    return alternatives;
  }

  /**
   * Estimate success probability for a plan
   */
  private estimateSuccessProbability(root: MCTSNode, plan: PlannedAction[]): number {
    if (plan.length === 0) return 0;

    let current: MCTSNode = root;
    let probability = 1;

    for (const action of plan) {
      const child = current.children.get(action.id);
      if (!child) {
        probability *= action.successProbability || 0.5;
        break;
      }

      // Use visit ratio as success proxy
      const actionSuccessRate = child.visits > 0 
        ? Math.max(0, child.totalValue / child.visits)
        : 0.5;
      
      probability *= actionSuccessRate;
      current = child;
    }

    return Math.max(0, Math.min(1, probability));
  }

  /**
   * Calculate tree statistics
   */
  private calculateTreeStats(root: MCTSNode): TreeStatistics {
    const stats = {
      totalNodes: 0,
      maxDepth: 0,
      terminalNodes: 0,
      totalSimulations: 0,
      totalChildren: 0
    };

    this.traverseTree(root, 0, stats);

    return {
      totalNodes: stats.totalNodes,
      maxDepth: stats.maxDepth,
      avgBranchingFactor: stats.totalNodes > 0 
        ? stats.totalChildren / stats.totalNodes 
        : 0,
      terminalNodes: stats.terminalNodes,
      totalSimulations: stats.totalSimulations
    };
  }

  private traverseTree(
    node: MCTSNode,
    depth: number,
    stats: { totalNodes: number; maxDepth: number; terminalNodes: number; totalSimulations: number; totalChildren: number }
  ): void {
    stats.totalNodes++;
    stats.totalSimulations += node.visits;
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    stats.totalChildren += node.children.size;

    if (node.state.isTerminal) {
      stats.terminalNodes++;
    }

    for (const child of node.children.values()) {
      this.traverseTree(child, depth + 1, stats);
    }
  }

  /**
   * Count total nodes
   */
  private countNodes(root: MCTSNode): number {
    let count = 1;
    for (const child of root.children.values()) {
      count += this.countNodes(child);
    }
    return count;
  }

  /**
   * Create root node
   */
  private async createRootNode(
    initialState: PlanningState,
    availableActions: string[]
  ): Promise<MCTSNode> {
    // Convert action type strings to PlannedAction objects
    const actions: PlannedAction[] = availableActions.map((type, index) => ({
      id: `action-${index}`,
      type,
      description: `Execute ${type}`,
      parameters: {},
      expectedOutcome: `Result of ${type}`,
      cost: 1,
      successProbability: 0.8
    }));

    return this.createNode(initialState, actions, null);
  }

  /**
   * Create MCTS node
   */
  private createNode(
    state: PlanningState,
    availableActions: PlannedAction[],
    parent: MCTSNode | null
  ): MCTSNode {
    this.nodeCounter++;
    
    return {
      id: `node-${this.nodeCounter}`,
      state,
      availableActions,
      children: new Map(),
      visits: 0,
      totalValue: 0,
      ucb1Score: 0,
      isFullyExpanded: false,
      untriedActions: [...availableActions]
    };
  }

  /**
   * Select random action
   */
  private selectRandomAction(actions: PlannedAction[]): PlannedAction {
    return actions[Math.floor(Math.random() * actions.length)];
  }

  /**
   * Select best action based on predictions
   */
  private selectBestAction(actions: PlannedAction[]): PlannedAction {
    if (!this.currentPredictions || actions.length <= 1) {
        return actions[Math.floor(Math.random() * actions.length)];
    }
    
    let bestAction = actions[0];
    let bestScore = -1;
    
    for (const action of actions) {
        let score = 0;
        
        if (this.currentPredictions.suggestedSources.some(s => action.type.includes(s) || s.includes(action.type))) {
            score += 10;
        }
        
        if (this.currentPredictions.priorityKeywords.some(k => action.description.includes(k) || action.type.includes(k))) {
            score += 5;
        }
        
        // Add a small random component to break ties and encourage exploration in rollouts
        score += Math.random();
        
        if (score > bestScore) {
            bestScore = score;
            bestAction = action;
        }
    }
    
    return bestAction;
  }

  /**
   * Get tree visualization (for debugging)
   */
  getTreeVisualization(): string {
    if (!this.rootNode) return 'No tree';
    return this.visualizeNode(this.rootNode, 0);
  }

  private visualizeNode(node: MCTSNode, depth: number): string {
    const indent = '  '.repeat(depth);
    const avgValue = node.visits > 0 ? (node.totalValue / node.visits).toFixed(2) : 'N/A';
    
    let result = `${indent}[${node.id}] visits=${node.visits}, value=${avgValue}, depth=${node.state.depth}\n`;
    
    for (const [actionId, child] of node.children) {
      result += `${indent}  -> ${actionId}:\n`;
      result += this.visualizeNode(child, depth + 2);
    }
    
    return result;
  }

  /**
   * Reset tree
   */
  reset(): void {
    this.rootNode = null;
    this.nodeCounter = 0;
    logger.info('MCTS tree reset');
  }
}
