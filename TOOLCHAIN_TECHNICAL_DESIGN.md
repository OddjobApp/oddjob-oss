# ToolChain* Integration: Technical Design Proposal

## Executive Summary

This document provides a comprehensive technical design for integrating ToolChain* (A* search-based planning) into Oddjob's tool execution infrastructure. ToolChain* addresses the action space explosion problem in LLM-based agents by formulating tool execution as a decision tree and applying A* search with task-specific cost functions.

**Impact:** 50% reduction in planning time, 3.1% improvement in planning tasks, 7.35x faster execution
**Timeline:** 6-8 weeks for full implementation
**Risk Level:** Medium (well-defined algorithm, integration complexity)
**Priority:** High (Phase 1, immediate impact)

---

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ToolChain* Planning Engine                │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Decision Tree Formulator                   │  │
│  │  • Task Analysis & Decomposition                     │  │
│  │  • Tool Dependency Analysis                          │  │
│  │  • Action Space Construction                         │  │
│  │  • Tree Structure Building                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              A* Search Engine                        │  │
│  │  • Priority Queue Management                         │  │
│  │  • Cost Function Evaluation                          │  │
│  │  • Heuristic Calculation                             │  │
│  │  • Branch Pruning                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Path Validation & Selection                 │  │
│  │  • Constraint Checking                               │  │
│  │  • Governor Policy Validation                        │  │
│  │  • Resource Availability Check                        │  │
│  │  • Optimal Path Identification                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Execution Coordinator                    │  │
│  │  • Sequential Tool Execution                          │  │
│  │  • Parallel Execution where possible                 │  │
│  │  • Error Handling & Recovery                         │  │
│  │  • Progress Tracking                                 │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Integration Points

```
Existing ToolChain* Integration
─────────────────────────────────────
toolRegistry.service.ts  →  Decision Tree Formulator
toolExecutor.service.ts  ←  Execution Coordinator
governorService.ts       →  Path Validation
agentOrchestrator.ts     ←  Planning Results
circuitBreaker.service   →  Cost Function
```

---

## 2. Component Design

### 2.1 Decision Tree Formulator

#### 2.1.1 Interface Definition

```typescript
interface DecisionTreeFormulator {
  formulateTree(
    task: AgentTask,
    availableTools: Tool[],
    context: AgentContext
  ): Promise<DecisionTree>;
  
  analyzeDependencies(tools: Tool[]): DependencyGraph;
  estimateCosts(toolCall: ToolCall, context: AgentContext): CostEstimate;
  buildTreeStructure(nodes: TreeNode[]): DecisionTree;
}

interface DecisionTree {
  rootNode: TreeNode;
  totalNodes: number;
  maxDepth: number;
  branchingFactor: number;
  actionSpaceSize: number;
}

interface TreeNode {
  id: string;
  toolCall: ToolCall | null; // null for root
  parent: TreeNode | null;
  children: TreeNode[];
  depth: number;
  
  // A* search properties
  gCost: number; // Actual cost from start
  hCost: number; // Heuristic cost to goal
  fCost: number; // Total estimated cost (g + h)
  
  // State tracking
  workspaceState: WorkspaceState;
  preconditions: string[];
  postconditions: string[];
  
  // Metadata
  estimatedExecutionTime: number;
  resourceRequirements: ResourceRequirements;
  confidence: number;
}

interface ToolCall {
  toolName: string;
  parameters: Record<string, any>;
  preconditions: string[];
  postconditions: string[];
  estimatedCost: number;
  estimatedTime: number;
}

interface WorkspaceState {
  files: Map<string, FileState>;
  variables: Map<string, any>;
  toolCallHistory: ToolCall[];
  constraints: Constraint[];
  resources: ResourceState;
}
```

#### 2.1.2 Implementation

```typescript
class DecisionTreeFormulatorImpl implements DecisionTreeFormulator {
  private toolRegistry: ToolRegistry;
  private dependencyAnalyzer: DependencyAnalyzer;
  private costEstimator: CostEstimator;
  
  constructor(
    toolRegistry: ToolRegistry,
    dependencyAnalyzer: DependencyAnalyzer,
    costEstimator: CostEstimator
  ) {
    this.toolRegistry = toolRegistry;
    this.dependencyAnalyzer = dependencyAnalyzer;
    this.costEstimator = costEstimator;
  }
  
  async formulateTree(
    task: AgentTask,
    availableTools: Tool[],
    context: AgentContext
  ): Promise<DecisionTree> {
    // Phase 1: Task Analysis
    const taskAnalysis = await this.analyzeTask(task, context);
    
    // Phase 2: Tool Selection & Filtering
    const relevantTools = await this.filterRelevantTools(
      taskAnalysis,
      availableTools,
      context
    );
    
    // Phase 3: Dependency Analysis
    const dependencyGraph = this.analyzeDependencies(relevantTools);
    
    // Phase 4: Action Space Construction
    const actionSpace = await this.constructActionSpace(
      taskAnalysis,
      relevantTools,
      dependencyGraph,
      context
    );
    
    // Phase 5: Tree Building
    const decisionTree = await this.buildTreeStructure(actionSpace, context);
    
    return decisionTree;
  }
  
  private async analyzeTask(
    task: AgentTask,
    context: AgentContext
  ): Promise<TaskAnalysis> {
    const analysis: TaskAnalysis = {
      objective: task.objective,
      complexity: await this.assessComplexity(task, context),
      requiredCapabilities: await this.extractRequiredCapabilities(task),
      constraints: task.constraints || [],
      estimatedSteps: await this.estimateSteps(task),
      resourceRequirements: await this.assessResourceNeeds(task, context)
    };
    
    return analysis;
  }
  
  private async filterRelevantTools(
    taskAnalysis: TaskAnalysis,
    availableTools: Tool[],
    context: AgentContext
  ): Promise<Tool[]> {
    const relevantTools: Tool[] = [];
    
    for (const tool of availableTools) {
      // Check capability match
      const capabilityMatch = this.checkCapabilityMatch(
        tool,
        taskAnalysis.requiredCapabilities
      );
      
      // Check constraint compatibility
      const constraintCompatible = await this.checkConstraintCompatibility(
        tool,
        taskAnalysis.constraints,
        context
      );
      
      // Check resource availability
      const resourceAvailable = this.checkResourceAvailability(
        tool,
        taskAnalysis.resourceRequirements
      );
      
      if (capabilityMatch && constraintCompatible && resourceAvailable) {
        relevantTools.push(tool);
      }
    }
    
    return relevantTools;
  }
  
  analyzeDependencies(tools: Tool[]): DependencyGraph {
    const graph = new DependencyGraph();
    
    // Build dependency matrix
    for (const toolA of tools) {
      for (const toolB of tools) {
        if (toolA.id === toolB.id) continue;
        
        const dependency = this.assessDependency(toolA, toolB);
        if (dependency.hasDependency) {
          graph.addDependency(toolA.id, toolB.id, dependency);
        }
      }
    }
    
    // Detect circular dependencies
    const cycles = graph.detectCycles();
    if (cycles.length > 0) {
      this.logger.warn(`Circular dependencies detected: ${cycles}`);
      // Resolve cycles by breaking weakest links
      graph.resolveCycles(cycles);
    }
    
    return graph;
  }
  
  private async constructActionSpace(
    taskAnalysis: TaskAnalysis,
    tools: Tool[],
    dependencyGraph: DependencyGraph,
    context: AgentContext
  ): Promise<ActionSpace> {
    const actionSpace: ActionSpace = {
      possibleToolCalls: [],
      initialState: this.createInitialState(context),
      goalState: this.createGoalState(taskAnalysis),
      constraints: taskAnalysis.constraints
    };
    
    // Generate possible tool calls with parameter variations
    for (const tool of tools) {
      const toolCalls = await this.generateToolCallVariations(
        tool,
        taskAnalysis,
        context
      );
      actionSpace.possibleToolCalls.push(...toolCalls);
    }
    
    // Order actions by dependency topological sort
    actionSpace.possibleToolCalls = this.topologicalSort(
      actionSpace.possibleToolCalls,
      dependencyGraph
    );
    
    return actionSpace;
  }
  
  private async buildTreeStructure(
    actionSpace: ActionSpace,
    context: AgentContext
  ): Promise<DecisionTree> {
    // Create root node (no tool call)
    const rootNode: TreeNode = {
      id: 'root',
      toolCall: null,
      parent: null,
      children: [],
      depth: 0,
      gCost: 0,
      hCost: this.calculateHeuristic(actionSpace.initialState, actionSpace.goalState),
      fCost: this.calculateHeuristic(actionSpace.initialState, actionSpace.goalState),
      workspaceState: actionSpace.initialState,
      preconditions: [],
      postconditions: [],
      estimatedExecutionTime: 0,
      resourceRequirements: this.createEmptyRequirements(),
      confidence: 1.0
    };
    
    // Build tree by expanding actions
    const tree = await this.expandTree(
      rootNode,
      actionSpace,
      context,
      0, // current depth
      this.maxTreeDepth
    );
    
    return {
      rootNode,
      totalNodes: this.countNodes(tree.rootNode),
      maxDepth: this.calculateMaxDepth(tree.rootNode),
      branchingFactor: this.calculateBranchingFactor(tree.rootNode),
      actionSpaceSize: actionSpace.possibleToolCalls.length
    };
  }
  
  private async expandTree(
    node: TreeNode,
    actionSpace: ActionSpace,
    context: AgentContext,
    currentDepth: number,
    maxDepth: number
  ): Promise<TreeNode> {
    if (currentDepth >= maxDepth) {
      return node;
    }
    
    // Find applicable actions for current state
    const applicableActions = this.findApplicableActions(
      node.workspaceState,
      actionSpace.possibleToolCalls
    );
    
    // Create child nodes for each applicable action
    for (const action of applicableActions) {
      const childNode = await this.createChildNode(
        node,
        action,
        actionSpace.goalState,
        context
      );
      
      node.children.push(childNode);
      
      // Recursively expand child
      await this.expandTree(
        childNode,
        actionSpace,
        context,
        currentDepth + 1,
        maxDepth
      );
    }
    
    return node;
  }
  
  private async createChildNode(
    parent: TreeNode,
    action: ToolCall,
    goalState: WorkspaceState,
    context: AgentContext
  ): Promise<TreeNode> {
    // Simulate action execution
    const newState = await this.simulateAction(
      parent.workspaceState,
      action,
      context
    );
    
    // Calculate costs
    const gCost = parent.gCost + await this.costEstimator.estimateExecutionCost(action);
    const hCost = this.calculateHeuristic(newState, goalState);
    const fCost = gCost + hCost;
    
    const childNode: TreeNode = {
      id: `${parent.id}_${action.toolName}_${Date.now()}`,
      toolCall: action,
      parent: parent,
      children: [],
      depth: parent.depth + 1,
      gCost,
      hCost,
      fCost,
      workspaceState: newState,
      preconditions: action.preconditions,
      postconditions: action.postconditions,
      estimatedExecutionTime: action.estimatedTime,
      resourceRequirements: await this.assessResourceRequirements(action),
      confidence: await this.estimateConfidence(action, context)
    };
    
    return childNode;
  }
}
```

### 2.2 A* Search Engine

#### 2.2.1 Interface Definition

```typescript
interface AStarSearchEngine {
  search(
    decisionTree: DecisionTree,
    goalState: WorkspaceState,
    constraints: Constraint[],
    context: AgentContext
  ): Promise<SearchResult>;
  
  calculateHeuristic(
    currentState: WorkspaceState,
    goalState: WorkspaceState
  ): number;
  
  evaluateCostFunction(
    node: TreeNode,
    context: AgentContext
  ): number;
  
  pruneBranches(
    node: TreeNode,
    threshold: number
  ): void;
}

interface SearchResult {
  optimalPath: TreeNode[];
  totalCost: number;
  searchDuration: number;
  nodesExplored: number;
  branchesPruned: number;
  success: boolean;
  reasoning: string;
}
```

#### 2.2.2 Implementation

```typescript
class AStarSearchEngineImpl implements AStarSearchEngine {
  private priorityQueue: PriorityQueue<TreeNode>;
  private costFunction: CostFunction;
  private heuristicFunction: HeuristicFunction;
  private governorService: GovernorService;
  
  constructor(
    costFunction: CostFunction,
    heuristicFunction: HeuristicFunction,
    governorService: GovernorService
  ) {
    this.priorityQueue = new PriorityQueue<TreeNode>((a, b) => a.fCost - b.fCost);
    this.costFunction = costFunction;
    this.heuristicFunction = heuristicFunction;
    this.governorService = governorService;
  }
  
  async search(
    decisionTree: DecisionTree,
    goalState: WorkspaceState,
    constraints: Constraint[],
    context: AgentContext
  ): Promise<SearchResult> {
    const startTime = Date.now();
    let nodesExplored = 0;
    let branchesPruned = 0;
    
    // Initialize priority queue with root node
    this.priorityQueue.clear();
    this.priorityQueue.enqueue(decisionTree.rootNode);
    
    const closedSet = new Set<string>();
    const optimalPath: TreeNode[] = [];
    
    while (!this.priorityQueue.isEmpty()) {
      // Get node with lowest fCost
      const currentNode = this.priorityQueue.dequeue();
      nodesExplored++;
      
      // Check if we've reached the goal
      if (this.isGoalState(currentNode.workspaceState, goalState)) {
        // Reconstruct path
        const path = this.reconstructPath(currentNode);
        return {
          optimalPath: path,
          totalCost: currentNode.gCost,
          searchDuration: Date.now() - startTime,
          nodesExplored,
          branchesPruned,
          success: true,
          reasoning: this.generateReasoning(path, nodesExplored, branchesPruned)
        };
      }
      
      // Skip if already evaluated
      if (closedSet.has(currentNode.id)) {
        continue;
      }
      closedSet.add(currentNode.id);
      
      // Validate constraints
      const constraintValid = await this.validateConstraints(
        currentNode,
        constraints,
        context
      );
      
      if (!constraintValid) {
        branchesPruned++;
        continue; // Skip this branch
      }
      
      // Expand current node
      for (const child of currentNode.children) {
        // Update costs
        child.gCost = currentNode.gCost + await this.evaluateCostFunction(child, context);
        child.hCost = this.calculateHeuristic(child.workspaceState, goalState);
        child.fCost = child.gCost + child.hCost;
        
        // Prune if cost exceeds threshold
        if (child.fCost > this.costThreshold) {
          branchesPruned++;
          continue;
        }
        
        // Add to priority queue
        this.priorityQueue.enqueue(child);
      }
    }
    
    // No path found
    return {
      optimalPath: [],
      totalCost: Infinity,
      searchDuration: Date.now() - startTime,
      nodesExplored,
      branchesPruned,
      success: false,
      reasoning: 'No valid path found within cost threshold'
    };
  }
  
  calculateHeuristic(
    currentState: WorkspaceState,
    goalState: WorkspaceState
  ): number {
    // Multi-factor heuristic calculation
    const stateDistance = this.calculateStateDistance(currentState, goalState);
    const remainingTools = this.estimateRequiredTools(currentState, goalState);
    const complexityScore = this.assessComplexity(goalState);
    const resourceGap = this.calculateResourceGap(currentState, goalState);
    
    // Weighted combination
    const heuristic = 
      stateDistance * 0.4 +
      remainingTools * 10 +
      complexityScore * 2 +
      resourceGap * 5;
    
    return heuristic;
  }
  
  private calculateStateDistance(
    current: WorkspaceState,
    goal: WorkspaceState
  ): number {
    let distance = 0;
    
    // File state differences
    for (const [filePath, goalFile] of goal.files) {
      const currentFile = current.files.get(filePath);
      if (!currentFile) {
        distance += 10; // File doesn't exist
      } else if (currentFile.content !== goalFile.content) {
        distance += 5; // File content differs
      }
    }
    
    // Variable differences
    for (const [varName, goalValue] of goal.variables) {
      const currentValue = current.variables.get(varName);
      if (currentValue !== goalValue) {
        distance += 3;
      }
    }
    
    // Constraint satisfaction
    for (const constraint of goal.constraints) {
      if (!this.isConstraintSatisfied(constraint, current)) {
        distance += 8;
      }
    }
    
    return distance;
  }
  
  async evaluateCostFunction(
    node: TreeNode,
    context: AgentContext
  ): Promise<number> {
    if (!node.toolCall) {
      return 0; // Root node has no cost
    }
    
    const toolCall = node.toolCall;
    
    // Execution cost
    const executionCost = await this.costEstimator.estimateExecutionCost(toolCall);
    
    // Time cost
    const timeCost = toolCall.estimatedTime / 1000; // Convert to seconds
    
    // Risk cost
    const riskCost = await this.assessToolRisk(toolCall, context);
    
    // Resource cost
    const resourceCost = this.calculateResourceCost(toolCall);
    
    // Opportunity cost (delaying other actions)
    const opportunityCost = node.depth * 0.5;
    
    // Confidence penalty (lower confidence = higher cost)
    const confidencePenalty = (1 - node.confidence) * 5;
    
    const totalCost = 
      executionCost +
      timeCost +
      riskCost +
      resourceCost +
      opportunityCost +
      confidencePenalty;
    
    return totalCost;
  }
  
  pruneBranches(node: TreeNode, threshold: number): void {
    if (node.fCost > threshold) {
      // Mark for pruning
      node.children = []; // Remove children
      return;
    }
    
    // Recursively prune children
    for (const child of node.children) {
      this.pruneBranches(child, threshold);
    }
  }
  
  private async validateConstraints(
    node: TreeNode,
    constraints: Constraint[],
    context: AgentContext
  ): Promise<boolean> {
    // Validate against governor policies
    if (node.toolCall) {
      try {
        await this.governorService.validateToolAccess(
          node.toolCall.toolName,
          context.governorConfig?.rules || []
        );
      } catch (error) {
        return false; // Tool access denied
      }
    }
    
    // Validate against custom constraints
    for (const constraint of constraints) {
      if (!this.isConstraintSatisfied(constraint, node.workspaceState)) {
        return false;
      }
    }
    
    return true;
  }
  
  private isGoalState(
    current: WorkspaceState,
    goal: WorkspaceState
  ): boolean {
    // Check if current state satisfies goal conditions
    const stateDistance = this.calculateStateDistance(current, goal);
    return stateDistance < this.goalThreshold;
  }
  
  private reconstructPath(node: TreeNode): TreeNode[] {
    const path: TreeNode[] = [];
    let current: TreeNode | null = node;
    
    while (current) {
      path.unshift(current);
      current = current.parent;
    }
    
    return path;
  }
  
  private generateReasoning(
    path: TreeNode[],
    nodesExplored: number,
    branchesPruned: number
  ): string {
    const toolSequence = path
      .filter(node => node.toolCall)
      .map(node => node.toolCall!.toolName)
      .join(' → ');
    
    return `Optimal path found: ${toolSequence}. Explored ${nodesExplored} nodes, pruned ${branchesPruned} branches. Total cost: ${path[path.length - 1].gCost.toFixed(2)}`;
  }
}
```

### 2.3 Path Validation & Selection

#### 2.3.1 Interface Definition

```typescript
interface PathValidator {
  validatePath(
    path: TreeNode[],
    context: AgentContext
  ): Promise<ValidationResult>;
  
  selectOptimalPath(
    candidates: TreeNode[][],
    context: AgentContext
  ): Promise<TreeNode[]>;
  
  checkGovernancePolicies(
    toolCall: ToolCall,
    context: AgentContext
  ): Promise<PolicyCheckResult>;
}

interface ValidationResult {
  valid: boolean;
  violations: PolicyViolation[];
  warnings: PolicyWarning[];
  requiredApprovals: ApprovalRequest[];
  modifiedPath?: TreeNode[];
}

interface PolicyCheckResult {
  allowed: boolean;
  reason: string;
  requiredApproval: boolean;
  conditions: PolicyCondition[];
}
```

#### 2.3.2 Implementation

```typescript
class PathValidatorImpl implements PathValidator {
  private governorService: GovernorService;
  private resourceMonitor: ResourceMonitor;
  private policyEngine: PolicyEngine;
  
  constructor(
    governorService: GovernorService,
    resourceMonitor: ResourceMonitor,
    policyEngine: PolicyEngine
  ) {
    this.governorService = governorService;
    this.resourceMonitor = resourceMonitor;
    this.policyEngine = policyEngine;
  }
  
  async validatePath(
    path: TreeNode[],
    context: AgentContext
  ): Promise<ValidationResult> {
    const violations: PolicyViolation[] = [];
    const warnings: PolicyWarning[] = [];
    const requiredApprovals: ApprovalRequest[] = [];
    
    // Validate each tool call in the path
    for (const node of path) {
      if (!node.toolCall) continue;
      
      // Check governor policies
      const policyCheck = await this.checkGovernancePolicies(
        node.toolCall,
        context
      );
      
      if (!policyCheck.allowed) {
        violations.push({
          toolCall: node.toolCall,
          reason: policyCheck.reason,
          severity: 'critical'
        });
      }
      
      if (policyCheck.requiredApproval) {
        requiredApprovals.push({
          toolCall: node.toolCall,
          reason: policyCheck.reason,
          conditions: policyCheck.conditions
        });
      }
      
      // Check resource availability
      const resourceCheck = await this.checkResourceAvailability(
        node.toolCall,
        context
      );
      
      if (!resourceCheck.available) {
        violations.push({
          toolCall: node.toolCall,
          reason: `Insufficient resources: ${resourceCheck.missingResources.join(', ')}`,
          severity: 'critical'
        });
      } else if (resourceCheck.warning) {
        warnings.push({
          toolCall: node.toolCall,
          reason: resourceCheck.warning,
          severity: 'warning'
        });
      }
      
      // Check dependencies
      const dependencyCheck = await this.checkDependencies(
        node,
        path,
        context
      );
      
      if (!dependencyCheck.satisfied) {
        violations.push({
          toolCall: node.toolCall,
          reason: `Unsatisfied dependencies: ${dependencyCheck.missingDependencies.join(', ')}`,
          severity: 'error'
        });
      }
    }
    
    // Check overall path constraints
    const pathConstraints = await this.checkPathConstraints(path, context);
    violations.push(...pathConstraints.violations);
    warnings.push(...pathConstraints.warnings);
    
    return {
      valid: violations.length === 0,
      violations,
      warnings,
      requiredApprovals
    };
  }
  
  async selectOptimalPath(
    candidates: TreeNode[][],
    context: AgentContext
  ): Promise<TreeNode[]> {
    if (candidates.length === 0) {
      throw new Error('No candidate paths provided');
    }
    
    if (candidates.length === 1) {
      return candidates[0];
    }
    
    // Score each candidate
    const scoredCandidates = await Promise.all(
      candidates.map(async (path) => ({
        path,
        score: await this.scorePath(path, context)
      }))
    );
    
    // Sort by score (descending)
    scoredCandidates.sort((a, b) => b.score - a.score);
    
    // Validate top candidate
    const topCandidate = scoredCandidates[0];
    const validation = await this.validatePath(topCandidate.path, context);
    
    if (validation.valid) {
      return topCandidate.path;
    }
    
    // Try next candidates if top is invalid
    for (let i = 1; i < scoredCandidates.length; i++) {
      const validation = await this.validatePath(scoredCandidates[i].path, context);
      if (validation.valid) {
        return scoredCandidates[i].path;
      }
    }
    
    // No valid path found
    throw new Error('No valid path found among candidates');
  }
  
  async checkGovernancePolicies(
    toolCall: ToolCall,
    context: AgentContext
  ): Promise<PolicyCheckResult> {
    try {
      // Check tool access
      this.governorService.validateToolAccess(
        toolCall.toolName,
        context.governorConfig?.rules || []
      );
      
      // Check budget
      const budgetCheck = await this.governorService.validateBudget(
        { executionId: context.executionId, organizationId: context.organizationId },
        context.governorConfig?.rules || []
      );
      
      if (!budgetCheck.allowed) {
        return {
          allowed: false,
          reason: budgetCheck.message || 'Budget exceeded',
          requiredApproval: false,
          conditions: []
        };
      }
      
      // Check auto-approval requirements
      const autoApprovalCheck = this.governorService.validateAutoApproval(
        toolCall.toolName,
        'execution',
        await this.estimateCost(toolCall),
        context.governorConfig?.rules || []
      );
      
      return {
        allowed: true,
        reason: 'All governance checks passed',
        requiredApproval: !autoApprovalCheck.allowed,
        conditions: autoApprovalCheck.reason ? [autoApprovalCheck.reason] : []
      };
      
    } catch (error: any) {
      return {
        allowed: false,
        reason: error.message || 'Governance check failed',
        requiredApproval: false,
        conditions: []
      };
    }
  }
  
  private async scorePath(
    path: TreeNode[],
    context: AgentContext
  ): Promise<number> {
    let score = 0;
    
    // Cost score (lower is better)
    const totalCost = path[path.length - 1].gCost;
    score -= totalCost * 0.3;
    
    // Length score (shorter is generally better)
    score -= path.length * 2;
    
    // Confidence score (higher is better)
    const avgConfidence = path.reduce((sum, node) => sum + node.confidence, 0) / path.length;
    score += avgConfidence * 10;
    
    // Resource efficiency score
    const resourceEfficiency = await this.calculateResourceEfficiency(path, context);
    score += resourceEfficiency * 5;
    
    // Parallelization potential score
    const parallelizationPotential = this.assessParallelizationPotential(path);
    score += parallelizationPotential * 3;
    
    // Risk score (lower risk is better)
    const riskScore = await this.assessPathRisk(path, context);
    score -= riskScore * 8;
    
    return score;
  }
  
  private async checkResourceAvailability(
    toolCall: ToolCall,
    context: AgentContext
  ): Promise<ResourceCheckResult> {
    const requirements = await this.assessResourceRequirements(toolCall);
    const available = await this.resourceMonitor.checkAvailability(requirements);
    
    return {
      available: available.sufficient,
      missingResources: available.missing,
      warning: available.warning
    };
  }
  
  private async checkDependencies(
    node: TreeNode,
    path: TreeNode[],
    context: AgentContext
  ): Promise<DependencyCheckResult> {
    const missingDependencies: string[] = [];
    
    if (!node.toolCall) {
      return { satisfied: true, missingDependencies: [] };
    }
    
    // Check if preconditions are met by previous nodes
    for (const precondition of node.toolCall.preconditions) {
      const satisfied = await this.isPreconditionSatisfied(
        precondition,
        path,
        node,
        context
      );
      
      if (!satisfied) {
        missingDependencies.push(precondition);
      }
    }
    
    return {
      satisfied: missingDependencies.length === 0,
      missingDependencies
    };
  }
}
```

### 2.4 Execution Coordinator

#### 2.4.1 Interface Definition

```typescript
interface ExecutionCoordinator {
  executePath(
    path: TreeNode[],
    context: AgentContext
  ): Promise<ExecutionResult>;
  
  executeSequentially(
    toolCalls: ToolCall[],
    context: AgentContext
  ): Promise<ExecutionResult>;
  
  executeWithParallelization(
    path: TreeNode[],
    context: AgentContext
  ): Promise<ExecutionResult>;
  
  handleExecutionError(
    error: ExecutionError,
    context: AgentContext
  ): Promise<ErrorHandlingResult>;
}

interface ExecutionResult {
  success: boolean;
  outputs: ToolOutput[];
  finalState: WorkspaceState;
  executionTime: number;
  totalCost: number;
  errors: ExecutionError[];
  stepsCompleted: number;
  totalSteps: number;
}
```

#### 2.4.2 Implementation

```typescript
class ExecutionCoordinatorImpl implements ExecutionCoordinator {
  private toolExecutor: ToolExecutor;
  private stateManager: StateManager;
  private parallelExecutor: ParallelExecutor;
  private errorHandler: ErrorHandler;
  
  constructor(
    toolExecutor: ToolExecutor,
    stateManager: StateManager,
    parallelExecutor: ParallelExecutor,
    errorHandler: ErrorHandler
  ) {
    this.toolExecutor = toolExecutor;
    this.stateManager = stateManager;
    this.parallelExecutor = parallelExecutor;
    this.errorHandler = errorHandler;
  }
  
  async executePath(
    path: TreeNode[],
    context: AgentContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const outputs: ToolOutput[] = [];
    const errors: ExecutionError[] = [];
    let currentState = this.stateManager.getInitialState(context);
    
    // Filter out root node and extract tool calls
    const toolCalls = path
      .filter(node => node.toolCall)
      .map(node => node.toolCall!);
    
    // Analyze path for parallelization opportunities
    const parallelizationPlan = this.analyzeParallelization(path);
    
    let stepsCompleted = 0;
    
    if (parallelizationPlan.canParallelize) {
      // Execute with parallelization
      const parallelResult = await this.executeWithParallelization(path, context);
      outputs.push(...parallelResult.outputs);
      errors.push(...parallelResult.errors);
      stepsCompleted = parallelResult.stepsCompleted;
      currentState = parallelResult.finalState;
    } else {
      // Execute sequentially
      for (const toolCall of toolCalls) {
        try {
          const output = await this.executeToolCall(toolCall, currentState, context);
          outputs.push(output);
          
          // Update state
          currentState = await this.stateManager.updateState(
            currentState,
            toolCall,
            output
          );
          
          stepsCompleted++;
        } catch (error) {
          const executionError: ExecutionError = {
            toolCall,
            error: error as Error,
            timestamp: new Date(),
            recoverable: await this.errorHandler.isRecoverable(error as Error)
          };
          errors.push(executionError);
          
          // Handle error
          const handlingResult = await this.handleExecutionError(
            executionError,
            context
          );
          
          if (handlingResult.shouldAbort) {
            break;
          }
          
          if (handlingResult.retryAction) {
            // Retry with modified parameters
            const retryOutput = await this.executeToolCall(
              handlingResult.retryAction,
              currentState,
              context
            );
            outputs.push(retryOutput);
            currentState = await this.stateManager.updateState(
              currentState,
              handlingResult.retryAction,
              retryOutput
            );
            stepsCompleted++;
          }
        }
      }
    }
    
    const executionTime = Date.now() - startTime;
    const totalCost = await this.calculateTotalCost(outputs, executionTime);
    
    return {
      success: errors.length === 0,
      outputs,
      finalState: currentState,
      executionTime,
      totalCost,
      errors,
      stepsCompleted,
      totalSteps: toolCalls.length
    };
  }
  
  async executeSequentially(
    toolCalls: ToolCall[],
    context: AgentContext
  ): Promise<ExecutionResult> {
    // Reuse executePath with sequential-only path
    const path = this.createSequentialPath(toolCalls);
    return this.executePath(path, context);
  }
  
  async executeWithParallelization(
    path: TreeNode[],
    context: AgentContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const outputs: ToolOutput[] = [];
    const errors: ExecutionError[] = [];
    let currentState = this.stateManager.getInitialState(context);
    
    // Build execution graph
    const executionGraph = this.buildExecutionGraph(path);
    
    // Execute in topological order with parallelization
    const executionLevels = this.topologicalSortExecution(executionGraph);
    
    let stepsCompleted = 0;
    
    for (const level of executionLevels) {
      // Execute all tools in this level in parallel
      const levelResults = await Promise.allSettled(
        level.map(async (node) => {
          try {
            const output = await this.executeToolCall(
              node.toolCall!,
              currentState,
              context
            );
            return { success: true, output, node };
          } catch (error) {
            return { 
              success: false, 
              error: error as Error, 
              node 
            };
          }
        })
      );
      
      // Process results
      for (const result of levelResults) {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            outputs.push(result.value.output);
            currentState = await this.stateManager.updateState(
              currentState,
              result.value.node.toolCall!,
              result.value.output
            );
            stepsCompleted++;
          } else {
            const executionError: ExecutionError = {
              toolCall: result.value.node.toolCall!,
              error: result.value.error,
              timestamp: new Date(),
              recoverable: await this.errorHandler.isRecoverable(result.value.error)
            };
            errors.push(executionError);
          }
        }
      }
      
      // Check if we should continue after errors
      if (errors.length > 0) {
        const shouldContinue = await this.shouldContinueAfterErrors(errors, context);
        if (!shouldContinue) {
          break;
        }
      }
    }
    
    const executionTime = Date.now() - startTime;
    const totalCost = await this.calculateTotalCost(outputs, executionTime);
    
    return {
      success: errors.length === 0,
      outputs,
      finalState: currentState,
      executionTime,
      totalCost,
      errors,
      stepsCompleted,
      totalSteps: path.filter(node => node.toolCall).length
    };
  }
  
  async handleExecutionError(
    error: ExecutionError,
    context: AgentContext
  ): Promise<ErrorHandlingResult> {
    // Analyze error type
    const errorAnalysis = await this.errorHandler.analyzeError(error);
    
    switch (errorAnalysis.type) {
      case 'recoverable':
        // Attempt recovery
        const recoveryAction = await this.errorHandler.suggestRecovery(error);
        return {
          shouldAbort: false,
          retryAction: recoveryAction,
          fallbackAction: null
        };
      
      case 'fallback_available':
        // Use fallback
        const fallbackAction = await this.errorHandler.suggestFallback(error);
        return {
          shouldAbort: false,
          retryAction: null,
          fallbackAction
        };
      
      case 'critical':
        // Abort execution
        return {
          shouldAbort: true,
          retryAction: null,
          fallbackAction: null
        };
      
      default:
        // Conservative approach: abort
        return {
          shouldAbort: true,
          retryAction: null,
          fallbackAction: null
        };
    }
  }
  
  private async executeToolCall(
    toolCall: ToolCall,
    currentState: WorkspaceState,
    context: AgentContext
  ): Promise<ToolOutput> {
    // Prepare execution context
    const executionContext = {
      ...context,
      workspaceState: currentState,
      toolCall
    };
    
    // Execute tool
    const output = await this.toolExecutor.execute(
      toolCall.toolName,
      toolCall.parameters,
      executionContext,
      context.availableTools || [],
      context.dryRun || false,
      context.supervisionLevel || 'standard',
      context.traceContext
    );
    
    return {
      toolCall,
      output,
      timestamp: new Date(),
      success: !output.startsWith('Error:')
    };
  }
  
  private analyzeParallelization(path: TreeNode[]): ParallelizationPlan {
    // Analyze dependencies between tool calls
    const dependencyGraph = this.buildDependencyGraph(path);
    
    // Identify independent tool calls that can run in parallel
    const parallelizableGroups = this.identifyParallelizableGroups(dependencyGraph);
    
    return {
      canParallelize: parallelizableGroups.length > 1,
      parallelizableGroups,
      estimatedSpeedup: this.estimateSpeedup(parallelizableGroups)
    };
  }
  
  private buildExecutionGraph(path: TreeNode[]): ExecutionGraph {
    const graph = new ExecutionGraph();
    
    // Add nodes
    for (const node of path) {
      if (node.toolCall) {
        graph.addNode(node.id, node.toolCall);
      }
    }
    
    // Add edges based on dependencies
    for (let i = 0; i < path.length; i++) {
      const currentNode = path[i];
      if (!currentNode.toolCall) continue;
      
      for (let j = i + 1; j < path.length; j++) {
        const nextNode = path[j];
        if (!nextNode.toolCall) continue;
        
        // Check if next node depends on current node
        if (this.hasDependency(currentNode, nextNode)) {
          graph.addEdge(currentNode.id, nextNode.id);
        }
      }
    }
    
    return graph;
  }
  
  private topologicalSortExecution(graph: ExecutionGraph): TreeNode[][] {
    const levels: TreeNode[][] = [];
    const visited = new Set<string>();
    const inDegree = new Map<string, number>();
    
    // Calculate in-degrees
    for (const node of graph.getNodes()) {
      inDegree.set(node.id, graph.getInDegree(node.id));
    }
    
    // Process nodes with in-degree 0
    const queue = graph.getNodes().filter(node => inDegree.get(node.id) === 0);
    
    while (queue.length > 0) {
      const currentLevel = [...queue];
      levels.push(currentLevel);
      
      // Remove current level from graph
      for (const node of currentLevel) {
        visited.add(node.id);
        
        // Reduce in-degree of neighbors
        for (const neighbor of graph.getNeighbors(node.id)) {
          const newDegree = (inDegree.get(neighbor.id) || 0) - 1;
          inDegree.set(neighbor.id, newDegree);
          
          if (newDegree === 0 && !visited.has(neighbor.id)) {
            queue.push(neighbor);
          }
        }
      }
      
      // Remove processed nodes from queue
      queue.length = 0;
      
      // Add new nodes with in-degree 0
      for (const node of graph.getNodes()) {
        if (inDegree.get(node.id) === 0 && !visited.has(node.id)) {
          queue.push(node);
        }
      }
    }
    
    return levels;
  }
}
```

---

## 3. Integration with Existing Systems

### 3.1 Tool Executor Integration

```typescript
// Extend existing ToolExecutor with ToolChain* capabilities
class EnhancedToolExecutor extends ToolExecutor {
  private toolChainPlanner: ToolChainPlanner;
  
  constructor(toolChainPlanner: ToolChainPlanner) {
    super();
    this.toolChainPlanner = toolChainPlanner;
  }
  
  async executeWithPlanning(
    task: AgentTask,
    context: AgentContext
  ): Promise<ExecutionResult> {
    // Use ToolChain* for planning
    const plan = await this.toolChainPlanner.planExecution(task, context);
    
    // Execute the plan
    const result = await this.executePath(plan.optimalPath, context);
    
    return result;
  }
  
  // Keep existing execute method for backward compatibility
  static async execute(
    toolName: string,
    toolParams: any,
    context: AgentContext,
    tools: any[],
    dryRun: boolean,
    supervisionLevel: SupervisionLevel,
    traceContext?: TraceContext
  ): Promise<string> {
    // Existing implementation...
  }
}
```

### 3.2 Agent Orchestrator Integration

```typescript
// Extend AgentOrchestrator to use ToolChain* planning
class ToolChainAwareAgentOrchestrator extends AgentOrchestrator {
  private toolChainPlanner: ToolChainPlanner;
  
  constructor(
    client: AIClient,
    apiKey: string,
    context: AgentContext,
    toolChainPlanner: ToolChainPlanner
  ) {
    super(client, apiKey, context);
    this.toolChainPlanner = toolChainPlanner;
  }
  
  protected async planToolUse(
    task: string,
    availableTools: Tool[]
  ): Promise<ToolExecutionPlan> {
    // Use ToolChain* for planning instead of basic tool selection
    const toolChainPlan = await this.toolChainPlanner.planExecution(
      { objective: task, constraints: this.context.constraints },
      this.context
    );
    
    return {
      toolCalls: toolChainPlan.optimalPath
        .filter(node => node.toolCall)
        .map(node => node.toolCall!),
      estimatedCost: toolChainPlan.totalCost,
      estimatedTime: toolChainPlan.estimatedTime,
      reasoning: toolChainPlan.reasoning
    };
  }
}
```

### 3.3 Governor Service Integration

```typescript
// Extend governor service with ToolChain* specific validations
class ToolChainAwareGovernorService extends GovernorService {
  async validateToolChainPlan(
    plan: ToolChainPlan,
    context: AgentContext
  ): Promise<ValidationResult> {
    const violations: PolicyViolation[] = [];
    
    // Validate each tool call in the plan
    for (const node of plan.optimalPath) {
      if (node.toolCall) {
        try {
          this.validateToolAccess(
            node.toolCall.toolName,
            context.governorConfig?.rules || []
          );
        } catch (error) {
          violations.push({
            toolCall: node.toolCall,
            reason: error.message,
            severity: 'critical'
          });
        }
      }
    }
    
    // Validate total cost against budget
    const budgetCheck = await this.validateBudget(
      { executionId: context.executionId, organizationId: context.organizationId },
      context.governorConfig?.rules || []
    );
    
    if (!budgetCheck.allowed && plan.totalCost > this.getRemainingBudget(context)) {
      violations.push({
        toolCall: null,
        reason: 'Plan cost exceeds remaining budget',
        severity: 'critical'
      });
    }
    
    return {
      valid: violations.length === 0,
      violations,
      warnings: [],
      requiredApprovals: []
    };
  }
}
```

---

## 4. Performance Optimization

### 4.1 Caching Strategies

```typescript
class ToolChainCache {
  private decisionTreeCache: Map<string, DecisionTree>;
  private searchResultCache: Map<string, SearchResult>;
  private costEstimateCache: Map<string, CostEstimate>;
  
  constructor() {
    this.decisionTreeCache = new Map();
    this.searchResultCache = new Map();
    this.costEstimateCache = new Map();
  }
  
  getCachedDecisionTree(taskKey: string): DecisionTree | null {
    return this.decisionTreeCache.get(taskKey) || null;
  }
  
  cacheDecisionTree(taskKey: string, tree: DecisionTree): void {
    this.decisionTreeCache.set(taskKey, tree);
  }
  
  getCachedSearchResult(searchKey: string): SearchResult | null {
    return this.searchResultCache.get(searchKey) || null;
  }
  
  cacheSearchResult(searchKey: string, result: SearchResult): void {
    this.searchResultCache.set(searchKey, result);
  }
  
  invalidateCache(pattern: string): void {
    // Invalidate cache entries matching pattern
    for (const key of this.decisionTreeCache.keys()) {
      if (key.match(pattern)) {
        this.decisionTreeCache.delete(key);
      }
    }
    
    for (const key of this.searchResultCache.keys()) {
      if (key.match(pattern)) {
        this.searchResultCache.delete(key);
      }
    }
  }
}
```

### 4.2 Parallel Processing

```typescript
class ParallelToolChainProcessor {
  async processMultipleTasks(
    tasks: AgentTask[],
    context: AgentContext
  ): Promise<Map<string, SearchResult>> {
    const results = new Map<string, string>();
    
    // Process tasks in parallel batches
    const batchSize = this.calculateOptimalBatchSize(tasks.length);
    
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          const result = await this.toolChainPlanner.planExecution(task, context);
          return [task.id, result] as [string, SearchResult];
        })
      );
      
      batchResults.forEach(([taskId, result]) => {
        results.set(taskId, result);
      });
    }
    
    return results;
  }
  
  private calculateOptimalBatchSize(totalTasks: number): number {
    // Calculate based on available resources and task complexity
    const availableCores = os.cpus().length;
    const memoryPerTask = this.estimateMemoryPerTask();
    const availableMemory = this.getAvailableMemory();
    
    const coreLimited = Math.floor(availableCores * 0.8); // Use 80% of cores
    const memoryLimited = Math.floor(availableMemory / memoryPerTask);
    
    return Math.min(coreLimited, memoryLimited, 4); // Max 4 parallel tasks
  }
}
```

### 4.3 Incremental Planning

```typescript
class IncrementalPlanner {
  async updateExistingPlan(
    existingPlan: ToolChainPlan,
    newInformation: NewInformation,
    context: AgentContext
  ): Promise<ToolChainPlan> {
    // Instead of replanning from scratch, update existing plan
    const updatedPlan = { ...existingPlan };
    
    // Identify affected parts of the plan
    const affectedNodes = this.identifyAffectedNodes(
      existingPlan.optimalPath,
      newInformation
    );
    
    // Replan only affected subtrees
    for (const node of affectedNodes) {
      const replannedSubtree = await this.replanSubtree(
        node,
        newInformation,
        context
      );
      
      // Replace subtree in plan
      this.replaceSubtree(updatedPlan, node, replannedSubtree);
    }
    
    // Recalculate costs
    updatedPlan.totalCost = await this.recalculateTotalCost(updatedPlan);
    
    return updatedPlan;
  }
  
  private identifyAffectedNodes(
    path: TreeNode[],
    newInformation: NewInformation
  ): TreeNode[] {
    const affected: TreeNode[] = [];
    
    for (const node of path) {
      if (this.isNodeAffected(node, newInformation)) {
        affected.push(node);
      }
    }
    
    return affected;
  }
}
```

---

## 5. Monitoring & Observability

### 5.1 Metrics Collection

```typescript
class ToolChainMetrics {
  private metricsCollector: MetricsCollector;
  
  constructor(metricsCollector: MetricsCollector) {
    this.metricsCollector = metricsCollector;
  }
  
  recordPlanningMetrics(plan: ToolChainPlan): void {
    this.metricsCollector.recordMetric('toolchain.planning.duration', plan.planningDuration);
    this.metricsCollector.recordMetric('toolchain.planning.nodes_explored', plan.nodesExplored);
    this.metricsCollector.recordMetric('toolchain.planning.branches_pruned', plan.branchesPruned);
    this.metricsCollector.recordMetric('toolchain.planning.tree_size', plan.treeSize);
    this.metricsCollector.recordMetric('toolchain.planning.max_depth', plan.maxDepth);
  }
  
  recordExecutionMetrics(result: ExecutionResult): void {
    this.metricsCollector.recordMetric('toolchain.execution.duration', result.executionTime);
    this.metricsCollector.recordMetric('toolchain.execution.total_cost', result.totalCost);
    this.metricsCollector.recordMetric('toolchain.execution.steps_completed', result.stepsCompleted);
    this.metricsCollector.recordMetric('toolchain.execution.steps_total', result.totalSteps);
    this.metricsCollector.recordMetric('toolchain.execution.success', result.success ? 1 : 0);
    this.metricsCollector.recordMetric('toolchain.execution.error_count', result.errors.length);
  }
  
  recordCacheMetrics(cache: ToolChainCache): void {
    this.metricsCollector.recordMetric('toolchain.cache.decision_tree_size', cache.getDecisionTreeCacheSize());
    this.metricsCollector.recordMetric('toolchain.cache.search_result_size', cache.getSearchResultCacheSize());
    this.metricsCollector.recordMetric('toolchain.cache.hit_rate', cache.getHitRate());
  }
}
```

### 5.2 Distributed Tracing

```typescript
class ToolChainTracing {
  private tracer: Tracer;
  
  constructor(tracer: Tracer) {
    this.tracer = tracer;
  }
  
  async tracePlanning(
    task: AgentTask,
    context: AgentContext,
    planningFn: () => Promise<ToolChainPlan>
  ): Promise<ToolChainPlan> {
    const span = this.tracer.startSpan('toolchain.planning', {
      taskId: task.id,
      organizationId: context.organizationId,
      agentId: context.agentId
    });
    
    try {
      const result = await planningFn();
      
      span.setAttributes({
        'planning.duration': result.planningDuration,
        'nodes.explored': result.nodesExplored,
        'branches.pruned': result.branchesPruned,
        'path.length': result.optimalPath.length,
        'total.cost': result.totalCost
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  }
  
  async traceExecution(
    plan: ToolChainPlan,
    context: AgentContext,
    executionFn: () => Promise<ExecutionResult>
  ): Promise<ExecutionResult> {
    const span = this.tracer.startSpan('toolchain.execution', {
      planId: plan.id,
      organizationId: context.organizationId,
      agentId: context.agentId
    });
    
    try {
      const result = await executionFn();
      
      span.setAttributes({
        'execution.duration': result.executionTime,
        'total.cost': result.totalCost,
        'steps.completed': result.stepsCompleted,
        'steps.total': result.totalSteps,
        'success': result.success,
        'error.count': result.errors.length
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  }
}
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

```typescript
describe('DecisionTreeFormulator', () => {
  let formulator: DecisionTreeFormulator;
  let mockToolRegistry: MockToolRegistry;
  let mockDependencyAnalyzer: MockDependencyAnalyzer;
  let mockCostEstimator: MockCostEstimator;
  
  beforeEach(() => {
    mockToolRegistry = new MockToolRegistry();
    mockDependencyAnalyzer = new MockDependencyAnalyzer();
    mockCostEstimator = new MockCostEstimator();
    
    formulator = new DecisionTreeFormulatorImpl(
      mockToolRegistry,
      mockDependencyAnalyzer,
      mockCostEstimator
    );
  });
  
  describe('formulateTree', () => {
    it('should create a decision tree with valid structure', async () => {
      const task = createMockTask();
      const tools = createMockTools();
      const context = createMockContext();
      
      const tree = await formulator.formulateTree(task, tools, context);
      
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.toolCall).toBeNull(); // Root has no tool call
      expect(tree.totalNodes).toBeGreaterThan(0);
      expect(tree.maxDepth).toBeGreaterThan(0);
    });
    
    it('should analyze tool dependencies correctly', async () => {
      const tools = createMockTools();
      const dependencyGraph = formulator.analyzeDependencies(tools);
      
      expect(dependencyGraph).toBeDefined();
      expect(dependencyGraph.getNodes().length).toBe(tools.length);
    });
  });
});
```

### 6.2 Integration Tests

```typescript
describe('ToolChain Integration', () => {
  let toolChainPlanner: ToolChainPlanner;
  let mockToolExecutor: MockToolExecutor;
  let mockGovernorService: MockGovernorService;
  
  beforeEach(async () => {
    mockToolExecutor = new MockToolExecutor();
    mockGovernorService = new MockGovernorService();
    
    toolChainPlanner = new ToolChainPlanner(
      mockToolExecutor,
      mockGovernorService
    );
    
    await toolChainPlanner.initialize();
  });
  
  describe('end-to-end planning and execution', () => {
    it('should plan and execute a simple task successfully', async () => {
      const task = {
        id: 'test-task-1',
        objective: 'Read a file and analyze its content',
        constraints: []
      };
      
      const context = createMockContext();
      
      // Plan execution
      const plan = await toolChainPlanner.planExecution(task, context);
      
      expect(plan.success).toBe(true);
      expect(plan.optimalPath.length).toBeGreaterThan(0);
      
      // Execute plan
      const result = await toolChainPlanner.executePlan(plan, context);
      
      expect(result.success).toBe(true);
      expect(result.stepsCompleted).toBe(result.totalSteps);
    });
    
    it('should handle governor policy violations correctly', async () => {
      const task = {
        id: 'test-task-2',
        objective: 'Execute a restricted tool',
        constraints: []
      };
      
      const context = createMockContext();
      mockGovernorService.setToolAccessDenied('restricted_tool');
      
      const plan = await toolChainPlanner.planExecution(task, context);
      
      expect(plan.success).toBe(false);
      expect(plan.violations.length).toBeGreaterThan(0);
    });
  });
});
```

### 6.3 Performance Tests

```typescript
describe('ToolChain Performance', () => {
  let toolChainPlanner: ToolChainPlanner;
  
  beforeEach(async () => {
    toolChainPlanner = new ToolChainPlanner(/* ... */);
    await toolChainPlanner.initialize();
  });
  
  describe('planning performance', () => {
    it('should complete planning within acceptable time limits', async () => {
      const task = createComplexTask();
      const context = createMockContext();
      
      const startTime = Date.now();
      const plan = await toolChainPlanner.planExecution(task, context);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(5000); // 5 seconds max
      expect(plan.success).toBe(true);
    });
    
    it('should handle large action spaces efficiently', async () => {
      const task = createTaskWithManyTools(100); // 100 tools
      const context = createMockContext();
      
      const startTime = Date.now();
      const plan = await toolChainPlanner.planExecution(task, context);
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(10000); // 10 seconds max
      expect(plan.branchesPruned).toBeGreaterThan(0); // Should prune branches
    });
  });
});
```

---

## 7. Deployment Strategy

### 7.1 Phased Rollout

**Phase 1: Shadow Mode (2 weeks)**
- Deploy ToolChain* in shadow mode alongside existing planner
- Compare planning quality and performance
- Collect metrics and gather feedback
- No impact on production traffic

**Phase 2: Canary Deployment (2 weeks)**
- Route 5% of traffic to ToolChain*
- Monitor for errors and performance issues
- Compare success rates and user satisfaction
- Gradually increase to 10%, then 25%

**Phase 3: Full Rollout (1 week)**
- Route 100% of traffic to ToolChain*
- Maintain fallback to existing planner
- Monitor closely for first week
- Keep shadow mode for comparison

**Phase 4: Optimization (ongoing)**
- Analyze production metrics
- Optimize parameters and heuristics
- Implement performance improvements
- Add additional features based on usage patterns

### 7.2 Configuration Management

```typescript
interface ToolChainConfiguration {
  // Search parameters
  maxTreeDepth: number;
  costThreshold: number;
  goalThreshold: number;
  searchTimeout: number;
  
  // Heuristic weights
  stateDistanceWeight: number;
  remainingToolsWeight: number;
  complexityWeight: number;
  resourceGapWeight: number;
  
  // Cost function weights
  executionCostWeight: number;
  timeCostWeight: number;
  riskCostWeight: number;
  resourceCostWeight: number;
  opportunityCostWeight: number;
  confidencePenaltyWeight: number;
  
  // Caching
  enableDecisionTreeCache: boolean;
  enableSearchResultCache: boolean;
  cacheTTL: number;
  
  // Parallelization
  enableParallelExecution: boolean;
  maxParallelTasks: number;
  
  // Monitoring
  enableDetailedMetrics: boolean;
  enableDistributedTracing: boolean;
}

const defaultConfiguration: ToolChainConfiguration = {
  maxTreeDepth: 10,
  costThreshold: 1000,
  goalThreshold: 5,
  searchTimeout: 30000,
  
  stateDistanceWeight: 0.4,
  remainingToolsWeight: 10,
  complexityWeight: 2,
  resourceGapWeight: 5,
  
  executionCostWeight: 1.0,
  timeCostWeight: 1.0,
  riskCostWeight: 1.0,
  resourceCostWeight: 1.0,
  opportunityCostWeight: 0.5,
  confidencePenaltyWeight: 5.0,
  
  enableDecisionTreeCache: true,
  enableSearchResultCache: true,
  cacheTTL: 3600000, // 1 hour
  
  enableParallelExecution: true,
  maxParallelTasks: 4,
  
  enableDetailedMetrics: true,
  enableDistributedTracing: true
};
```

---

## 8. Success Criteria

### 8.1 Technical Metrics

- **Planning Time Reduction:** >50% compared to baseline
- **Planning Success Rate:** >95% on benchmark tasks
- **Execution Cost Reduction:** >30% compared to baseline
- **Path Quality:** >90% of paths rated as optimal by human evaluators
- **Cache Hit Rate:** >70% for repeated tasks

### 8.2 Business Metrics

- **User Satisfaction:** >4.5/5 rating
- **Task Completion Rate:** >95% (baseline 85%)
- **API Cost Savings:** >30% reduction
- **Support Ticket Reduction:** >40% fewer planning-related issues

### 8.3 Operational Metrics

- **System Uptime:** >99.9%
- **Error Rate:** <0.1% of planning requests
- **Performance SLA:** 95th percentile <5 seconds for planning
- **Resource Utilization:** <80% of allocated resources

---

## 9. Risk Mitigation

### 9.1 Technical Risks

**Risk:** Poor heuristic function leading to suboptimal paths
**Mitigation:** 
- Extensive heuristic tuning on benchmark tasks
- A/B testing against baseline planner
- Fallback to baseline planner for critical tasks

**Risk:** Exponential tree growth for complex tasks
**Mitigation:**
- Implement aggressive branch pruning
- Set maximum tree depth limits
- Use incremental planning for complex tasks

**Risk:** Integration issues with existing tool executor
**Mitigation:**
- Comprehensive integration testing
- Backward compatibility maintained
- Feature flags for gradual rollout

### 9.2 Operational Risks

**Risk:** Performance degradation under load
**Mitigation:**
- Load testing before deployment
- Horizontal scaling capabilities
- Circuit breakers and rate limiting

**Risk:** Increased resource consumption
**Mitigation:**
- Resource monitoring and alerting
- Auto-scaling based on load
- Resource quotas and limits

### 9.3 Business Risks

**Risk:** User resistance to new planning behavior
**Mitigation:**
- User education and documentation
- Gradual rollout with feedback collection
- Ability to revert to baseline planner

---

## 10. Conclusion

This technical design provides a comprehensive implementation plan for integrating ToolChain* into Oddjob's tool execution infrastructure. The design addresses:

- **Architecture:** Clear component separation with well-defined interfaces
- **Integration:** Seamless integration with existing Oddjob services
- **Performance:** Optimization strategies for efficiency and scalability
- **Reliability:** Comprehensive error handling and fallback mechanisms
- **Observability:** Extensive monitoring and tracing capabilities
- **Testing:** Thorough testing strategy at multiple levels
- **Deployment:** Phased rollout with risk mitigation

The implementation will provide immediate impact through 50% faster planning and 30% cost reduction while maintaining Oddjob's commitment to safety and governance through integration with existing policy frameworks.

The 6-8 week implementation timeline is realistic given the well-defined algorithm and clear integration points, with phased rollout ensuring minimal disruption to existing operations.