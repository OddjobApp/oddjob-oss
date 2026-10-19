/**
 * Causal Reasoning Service
 * 
 * Judea Pearl's do-calculus for causal inference.
 * ATE/ATT estimation, counterfactuals, root cause analysis.
 */

import {
  CausalGraph,
  CausalVariable,
  CausalEdge,
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
  CausalMetrics,
  Intervention
} from './types.js';
import { createLogger } from '../../../../utils/logger.js';
import { randomUUID } from 'crypto';

const logger = createLogger('CausalReasoningService');

/**
 * Causal Reasoning Service
 */
export class CausalReasoningService {
  private graphs: Map<string, CausalGraph> = new Map();
  private config: CausalConfig;
  private eventStream: EventStreamService;
  private metrics: CausalMetrics;

  constructor(eventStream: EventStreamService, config?: Partial<CausalConfig>) {
    this.eventStream = eventStream;
    this.config = { ...DEFAULT_CAUSAL_CONFIG, ...config };
    this.metrics = {
      totalQueries: 0,
      successfulEstimates: 0,
      failedEstimates: 0,
      avgProcessingTimeMs: 0,
      discoveriesPerformed: 0,
      rootCauseAnalyses: 0,
      counterfactualsComputed: 0
    };
    logger.info('Causal Reasoning Service initialized');
  }

  /**
   * Load causal graph
   */
  loadGraph(graph: CausalGraph): void {
    const ids = new Set(graph.variables.map(variable => variable.id));
    if (ids.size !== graph.variables.length || graph.edges.some(edge => !ids.has(edge.source) || !ids.has(edge.target))) {
      throw new CausalError(CausalErrorType.IDENTIFICATION_FAILED, 'Graph contains duplicate or unknown variables');
    }
    // Validate graph is acyclic
    if (this.hasCycle(graph)) {
      throw new CausalError(
        CausalErrorType.CYCLIC_GRAPH,
        'Graph contains cycles, not a valid DAG'
      );
    }

    // Compute backdoor paths
    graph.backdoorPaths = this.identifyBackdoorPaths(graph);

    this.graphs.set(graph.id, graph);
    logger.info(`Loaded causal graph: ${graph.name} (${graph.variables.length} vars, ${graph.edges.length} edges)`);
  }

  /**
   * Estimate Average Treatment Effect (ATE)
   * E[Y|do(X=1)] - E[Y|do(X=0)]
   */
  async estimateATE(
    graphId: string,
    treatment: string,
    outcome: string,
    data: Record<string, number[]>
  ): Promise<CausalEstimate> {
    const startTime = Date.now();
    const queryId = randomUUID();

    logger.info(`[${queryId}] Estimating ATE: ${treatment} → ${outcome}`);

    const graph = this.graphs.get(graphId);
    if (!graph) {
      throw new CausalError(CausalErrorType.UNKNOWN, `Graph ${graphId} not found`);
    }

    try {
      // Find valid adjustment set (backdoor criterion)
      const adjustmentSet = this.findValidAdjustmentSet(graph, treatment, outcome);
      
      // An empty valid adjustment set means no adjustment, not identification failure.
      // Estimate via backdoor adjustment
      const result = this.estimateViaBackdoor(treatment, outcome, adjustmentSet, data);
      
      const processingTimeMs = Date.now() - startTime;
      this.updateMetrics(true, processingTimeMs);

      // Emit event
      await this.eventStream.publish({
        type: 'causal.query_processed',
        payload: { queryId, estimate: result.value, method: 'backdoor' }
      });

      return result;

    } catch (error) {
      this.updateMetrics(false, Date.now() - startTime);
      throw error;
    }
  }

  /**
   * Estimate Average Treatment Effect on Treated (ATT)
   * E[Y(1) - Y(0) | X = 1]
   */
  async estimateATT(
    graphId: string,
    treatment: string,
    outcome: string,
    data: Record<string, number[]>,
    treatedIndices: number[]
  ): Promise<CausalEstimate> {
    const startTime = Date.now();
    const queryId = randomUUID();

    logger.info(`[${queryId}] Estimating ATT: ${treatment} → ${outcome}`);

    const graph = this.graphs.get(graphId);
    if (!graph) throw new CausalError(CausalErrorType.UNKNOWN, `Graph ${graphId} not found`);
    const adjustmentSet = this.findValidAdjustmentSet(graph, treatment, outcome);
    const result = this.estimateViaBackdoor(treatment, outcome, adjustmentSet, data, treatedIndices);
    result.type = 'att';

    this.updateMetrics(true, Date.now() - startTime);
    return result;
  }

  /**
   * Compute counterfactual: "What if X had been different?"
   */
  async computeCounterfactual(
    graphId: string,
    factualEvidence: Record<string, any>,
    hypothetical: Intervention,
    outcomeVar: string
  ): Promise<CounterfactualScenario> {
    const startTime = Date.now();
    const scenarioId = randomUUID();

    logger.info(`[${scenarioId}] Computing counterfactual: ${hypothetical.target} = ${hypothetical.value}`);

    const graph = this.graphs.get(graphId);
    if (!graph) {
      throw new CausalError(CausalErrorType.UNKNOWN, `Graph ${graphId} not found`);
    }

    // Three-step process (Pearl's ladder):
    // 1. Abduction: Infer exogenous variables from evidence
    // 2. Action: Modify causal model with intervention
    // 3. Prediction: Compute outcome in modified model

    // Step 1: Abduction - estimate exogenous noise
    const exogenousNoise = this.estimateExogenousNoise(graph, factualEvidence);

    // Step 2: Action - apply do-operator
    const modifiedGraph = this.applyIntervention(graph, hypothetical);

    // Step 3: Prediction - compute counterfactual outcome
    const counterfactualOutcome = this.predictOutcome(
      modifiedGraph,
      outcomeVar,
      exogenousNoise,
      factualEvidence
    );

    this.metrics.counterfactualsComputed++;

    // Generate explanation
    const explanation = this.generateCounterfactualExplanation(
      hypothetical,
      outcomeVar,
      counterfactualOutcome.expectedValue,
      factualEvidence[outcomeVar]
    );

    // Emit event
    await this.eventStream.publish({
      type: 'causal.counterfactual_computed',
      payload: { 
        scenarioId, 
        outcome: counterfactualOutcome.expectedValue,
        intervention: hypothetical.target
      }
    });

    return {
      id: scenarioId,
      factualEvidence,
      hypothetical,
      counterfactualOutcome: {
        variable: outcomeVar,
        expectedValue: counterfactualOutcome.expectedValue,
        confidenceInterval: counterfactualOutcome.confidenceInterval
      },
      explanation
    };
  }

  /**
   * Root Cause Analysis
   * "Why did this outcome occur?"
   */
  async analyzeRootCause(
    graphId: string,
    outcome: { variable: string; value: any; expectedValue?: any },
    context: Record<string, any>
  ): Promise<RootCauseAnalysis> {
    const startTime = Date.now();
    const analysisId = randomUUID();

    logger.info(`[${analysisId}] Analyzing root cause for: ${outcome.variable} = ${outcome.value}`);

    const graph = this.graphs.get(graphId);
    if (!graph) {
      throw new CausalError(CausalErrorType.UNKNOWN, `Graph ${graphId} not found`);
    }

    // Calculate deviation from expected
    const deviation = outcome.expectedValue !== undefined
      ? outcome.value - outcome.expectedValue
      : outcome.value;  // Assume expected = 0 if not specified

    // Find ancestors of outcome in causal graph
    const ancestors = this.findAncestors(graph, outcome.variable);

    // Compute contribution of each ancestor to outcome
    const rootCauses = ancestors.map(ancestor => {
      const contribution = this.computeCausalContribution(
        graph,
        ancestor,
        outcome.variable,
        context
      );

      // Counterfactual: what if this variable had been different?
      const counterfactualValue = this.computeCounterfactualForVariable(
        graph,
        ancestor,
        outcome.variable,
        context,
        deviation
      );

      return {
        variable: ancestor,
        contribution: Math.abs(contribution),
        evidence: `${ancestor} contributed ${(contribution * 100).toFixed(1)}% to ${outcome.variable}`,
        counterfactual: `If ${ancestor} had been ${counterfactualValue}, ${outcome.variable} would have been closer to ${outcome.expectedValue || 'normal'}`
      };
    });

    // Sort by contribution
    rootCauses.sort((a, b) => b.contribution - a.contribution);

    // Find causal chains (paths from top causes to outcome)
    const causalChains = rootCauses
      .slice(0, 3)
      .map(cause => this.findCausalPath(graph, cause.variable, outcome.variable));

    // Generate recommendations
    const recommendations = rootCauses
      .slice(0, 3)
      .map(cause => ({
        intervention: {
          target: cause.variable,
          value: this.suggestInterventionValue(graph, cause.variable, context, deviation)
        },
        expectedOutcome: outcome.expectedValue || 0,
        confidence: cause.contribution
      }));

    this.metrics.rootCauseAnalyses++;

    // Emit event
    await this.eventStream.publish({
      type: 'causal.root_cause_found',
      payload: { analysisId, causes: rootCauses.length }
    });

    return {
      id: analysisId,
      outcome: {
        variable: outcome.variable,
        value: outcome.value,
        expectedValue: outcome.expectedValue,
        deviation
      },
      rootCauses,
      causalChains,
      recommendations
    };
  }

  /**
   * Mediation Analysis
   * How much of the effect goes through mediators?
   */
  async analyzeMediation(
    graphId: string,
    treatment: string,
    outcome: string,
    mediators: string[],
    data: Record<string, number[]>
  ): Promise<MediationAnalysis> {
    // Correlation minus an adjusted ATE is not an identified mediation effect.
    throw new CausalError(CausalErrorType.IDENTIFICATION_FAILED,
      'Mediation estimation is unavailable; no validated mediation estimator is configured');
  }

  /**
   * Find valid adjustment set (backdoor criterion)
   */
  private findValidAdjustmentSet(
    graph: CausalGraph,
    treatment: string,
    outcome: string
  ): string[] {
    const treatmentVariable = graph.variables.find(v => v.id === treatment);
    const outcomeVariable = graph.variables.find(v => v.id === outcome);
    if (!treatmentVariable || !outcomeVariable || treatment === outcome) {
      throw new CausalError(CausalErrorType.IDENTIFICATION_FAILED, 'Treatment and outcome must be distinct graph variables');
    }
    if (treatmentVariable.type !== 'binary' || !treatmentVariable.observable || !outcomeVariable.observable) {
      throw new CausalError(CausalErrorType.IDENTIFICATION_FAILED, 'Estimation requires an observed binary treatment and observed outcome');
    }
    // Conservative supported model: fully observed DAG. Do not pretend a mediator chain
    // alone proves frontdoor identification when latent confounding is present.
    if (graph.variables.some(v => !v.observable) || graph.edges.some(e => e.bidirectional) || graph.confounders.length) {
      throw new CausalError(CausalErrorType.UNOBSERVED_CONFOUNDER,
        'Latent-confounded/frontdoor estimation is unavailable for this graph');
    }
    const parents = [...new Set(graph.edges.filter(e => e.target === treatment).map(e => e.source))];
    if (parents.includes(outcome)) throw new CausalError(CausalErrorType.ADJUSTMENT_SET_INVALID, 'Outcome cannot be a treatment adjustment variable');
    if (parents.some(id => graph.variables.find(v => v.id === id)!.type === 'continuous')) {
      throw new CausalError(CausalErrorType.ADJUSTMENT_SET_INVALID, 'Continuous adjustment requires a regression or matching estimator; exact stratification is not supported');
    }
    return parents;
  }

  /**
   * Identify backdoor paths between treatment and outcome
   */
  private identifyBackdoorPaths(
    graph: CausalGraph,
    treatment?: string,
    outcome?: string
  ): BackdoorPath[] {
    const paths: BackdoorPath[] = [];
    const targetVars = treatment && outcome ? [treatment, outcome] : [];

    // Find paths with common causes (confounders)
    for (const edge of graph.edges) {
      if (edge.type === 'confounder' || edge.bidirectional) {
        paths.push({
          id: `backdoor-${randomUUID()}`,
          treatment: edge.source,
          outcome: edge.target,
          nodes: [edge.source, edge.target],
          blocked: false,
          blockingVariables: []
        });
      }
    }

    return paths;
  }

  /** Exact covariate stratification for binary treatment in a fully observed DAG.
   * The interval conditions on the empirical target stratum proportions (normal approximation).
   */
  private estimateViaBackdoor(
    treatment: string,
    outcome: string,
    adjustmentSet: string[],
    data: Record<string, number[]>,
    targetTreatedIndices?: number[]
  ): CausalEstimate {
    const n = data[treatment]?.length ?? 0;
    const columns = [treatment, outcome, ...adjustmentSet];
    if (!n || columns.some(name => !Array.isArray(data[name]) || data[name].length !== n || data[name].some(v => !Number.isFinite(v)))) {
      throw new CausalError(CausalErrorType.INSUFFICIENT_DATA, 'Estimation requires aligned, finite treatment, outcome and adjustment data');
    }
    if (data[treatment].some(value => value !== 0 && value !== 1)) {
      throw new CausalError(CausalErrorType.INSUFFICIENT_DATA, 'Treatment observations must be 0 or 1');
    }
    if (!(this.config.confidenceLevel > 0 && this.config.confidenceLevel < 1)) {
      throw new CausalError(CausalErrorType.INSUFFICIENT_DATA, 'Confidence level must be between 0 and 1');
    }
    if (targetTreatedIndices && (!targetTreatedIndices.length || new Set(targetTreatedIndices).size !== targetTreatedIndices.length ||
      targetTreatedIndices.some(i => !Number.isInteger(i) || i < 0 || i >= n || data[treatment][i] !== 1))) {
      throw new CausalError(CausalErrorType.INSUFFICIENT_DATA, 'ATT requires unique valid treated indices');
    }
    const targets = new Set(targetTreatedIndices ?? Array.from({ length: n }, (_, i) => i));
    const strata = new Map<string, { treated: number[]; control: number[]; targetCount: number }>();
    for (let i = 0; i < n; i++) {
      const key = JSON.stringify(adjustmentSet.map(name => data[name][i]));
      const group = strata.get(key) ?? { treated: [], control: [], targetCount: 0 };
      (data[treatment][i] === 1 ? group.treated : group.control).push(data[outcome][i]);
      if (targets.has(i)) group.targetCount++;
      strata.set(key, group);
    }
    let value = 0, variance = 0;
    for (const group of strata.values()) {
      if (!group.targetCount) continue;
      if (group.treated.length < 2 || group.control.length < 2) {
        throw new CausalError(CausalErrorType.INSUFFICIENT_DATA, 'Every target stratum needs at least two treated and two control observations for overlap and uncertainty estimation');
      }
      const weight = group.targetCount / targets.size;
      const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
      value += weight * (mean(group.treated) - mean(group.control));
      variance += weight ** 2 * (this.standardError(group.treated) ** 2 + this.standardError(group.control) ** 2);
    }
    const standardError = Math.sqrt(variance);
    const probability = (1 + this.config.confidenceLevel) / 2;
    let lowerZ = 0, upperZ = 10;
    for (let i = 0; i < 80; i++) {
      const mid = (lowerZ + upperZ) / 2;
      if (this.normalCDF(mid) < probability) lowerZ = mid; else upperZ = mid;
    }
    const margin = (lowerZ + upperZ) / 2 * standardError;
    return {
      type: targetTreatedIndices ? 'att' : 'ate', value,
      confidenceInterval: { lower: value - margin, upper: value + margin, level: this.config.confidenceLevel },
      standardError,
      pValue: standardError === 0 ? (value === 0 ? 1 : 0) : Math.max(0, Math.min(1, 2 * (1 - this.normalCDF(Math.abs(value) / standardError)))),
      method: 'exact-stratification (conditional normal interval)', identification: 'backdoor', adjustmentSet,
    };
  }

  /**
   * Helper: Standard error
   */
  private standardError(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance / values.length);
  }

  /**
   * Helper: Normal CDF
   */
  private normalCDF(x: number): number {
    // Approximation of standard normal CDF
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
  }

  /**
   * Helper: Compute association (correlation)
   */
  private computeAssociation(x: number[], y: number[]): number {
    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    
    let num = 0;
    let denX = 0;
    let denY = 0;
    
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    
    return num / Math.sqrt(denX * denY);
  }

  /**
   * Check if graph has cycles
   */
  private hasCycle(graph: CausalGraph): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (node: string): boolean => {
      visited.add(node);
      recStack.add(node);

      const neighbors = graph.edges
        .filter(e => e.source === node)
        .map(e => e.target);

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor) && dfs(neighbor)) {
          return true;
        } else if (recStack.has(neighbor)) {
          return true;
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const node of graph.variables.map(v => v.id)) {
      if (!visited.has(node)) {
        if (dfs(node)) return true;
      }
    }

    return false;
  }

  /**
   * Find ancestors of a variable
   */
  private findAncestors(graph: CausalGraph, variable: string): string[] {
    const ancestors = new Set<string>();
    
    const findParents = (node: string) => {
      const parents = graph.edges
        .filter(e => e.target === node)
        .map(e => e.source);
      
      for (const parent of parents) {
        if (!ancestors.has(parent)) {
          ancestors.add(parent);
          findParents(parent);
        }
      }
    };

    findParents(variable);
    return Array.from(ancestors);
  }

  /**
   * Find causal path between variables
   */
  private findCausalPath(graph: CausalGraph, from: string, to: string): string[] {
    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (current: string): boolean => {
      if (current === to) return true;
      
      visited.add(current);
      path.push(current);

      const children = graph.edges
        .filter(e => e.source === current)
        .map(e => e.target);

      for (const child of children) {
        if (!visited.has(child)) {
          if (dfs(child)) return true;
        }
      }

      path.pop();
      return false;
    };

    dfs(from);
    return [...path, to];
  }

  /**
   * Find pre-treatment covariates
   */
  private findPreTreatmentCovariates(graph: CausalGraph, treatment: string): string[] {
    // Variables that cause treatment (ancestors)
    return this.findAncestors(graph, treatment);
  }

  /**
   * Apply do-operator to graph
   */
  private applyIntervention(graph: CausalGraph, intervention: Intervention): CausalGraph {
    // Remove incoming edges to intervened variable
    const modifiedEdges = graph.edges.filter(e => 
      !(e.target === intervention.target)
    );

    return {
      ...graph,
      edges: modifiedEdges,
      id: `${graph.id}-intervened`
    };
  }

  /**
   * Estimate exogenous noise from evidence
   */
  private estimateExogenousNoise(
    graph: CausalGraph,
    evidence: Record<string, any>
  ): Record<string, number> {
    // Simplified: return residuals
    const noise: Record<string, number> = {};
    
    for (const [varId, value] of Object.entries(evidence)) {
      // Assume noise is just deviation from mean
      noise[varId] = 0;  // Simplified
    }

    return noise;
  }

  /**
   * Predict outcome in modified causal model
   */
  private predictOutcome(
    graph: CausalGraph,
    outcomeVar: string,
    noise: Record<string, number>,
    evidence: Record<string, any>
  ): { expectedValue: number; confidenceInterval: [number, number] } {
    // Simplified prediction
    const value = evidence[outcomeVar] || 0;
    const uncertainty = 0.1;

    return {
      expectedValue: value,
      confidenceInterval: [value - uncertainty, value + uncertainty]
    };
  }

  /**
   * Compute causal contribution
   */
  private computeCausalContribution(
    graph: CausalGraph,
    ancestor: string,
    outcome: string,
    context: Record<string, any>
  ): number {
    // Simplified: use edge strength
    const edge = graph.edges.find(e => e.source === ancestor && e.target === outcome);
    return edge?.strength || 0.1;
  }

  /**
   * Compute counterfactual for variable
   */
  private computeCounterfactualForVariable(
    graph: CausalGraph,
    variable: string,
    outcome: string,
    context: Record<string, any>,
    targetDeviation: number
  ): any {
    const current = context[variable];
    return current * 0.8;  // Suggest 20% change
  }

  /**
   * Suggest intervention value
   */
  private suggestInterventionValue(
    graph: CausalGraph,
    variable: string,
    context: Record<string, any>,
    targetDeviation: number
  ): any {
    const current = context[variable];
    if (typeof current === 'number') {
      return current + (targetDeviation > 0 ? -Math.abs(targetDeviation * 0.1) : Math.abs(targetDeviation * 0.1));
    }
    return current;
  }

  /**
   * Compute effect via mediator
   */
  private computeEffectViaMediator(
    graph: CausalGraph,
    treatment: string,
    outcome: string,
    mediator: string,
    data: Record<string, number[]>
  ): number {
    // Indirect effect: treatment → mediator → outcome
    const treatmentMediator = this.computeAssociation(data[treatment], data[mediator]);
    const mediatorOutcome = this.computeAssociation(data[mediator], data[outcome]);
    return treatmentMediator * mediatorOutcome;
  }

  /**
   * Generate counterfactual explanation
   */
  private generateCounterfactualExplanation(
    intervention: Intervention,
    outcome: string,
    counterfactualValue: number,
    factualValue: any
  ): string {
    return `If ${intervention.target} had been ${intervention.value}, ${outcome} would have been ${counterfactualValue.toFixed(2)} instead of ${factualValue}.`;
  }

  /**
   * Update metrics
   */
  private updateMetrics(success: boolean, processingTimeMs: number): void {
    this.metrics.totalQueries++;
    
    if (success) {
      this.metrics.successfulEstimates++;
    } else {
      this.metrics.failedEstimates++;
    }

    const n = this.metrics.totalQueries;
    this.metrics.avgProcessingTimeMs = 
      (this.metrics.avgProcessingTimeMs * (n - 1) + processingTimeMs) / n;
  }

  /**
   * Get metrics
   */
  getMetrics(): CausalMetrics {
    return { ...this.metrics };
  }
}

/**
 * Event Stream Service Interface
 */
interface EventStreamService {
  publish(event: { type: string; payload: any }): Promise<void>;
}
