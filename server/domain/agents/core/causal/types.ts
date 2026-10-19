/**
 * Causal Reasoning - Types and Interfaces
 * 
 * Judea Pearl's causal inference framework for agents.
 * Do-calculus, counterfactuals, and root cause analysis.
 */

/**
 * Causal Variable - Node in causal graph
 */
export interface CausalVariable {
  /** Variable ID */
  id: string;
  
  /** Variable name */
  name: string;
  
  /** Variable type */
  type: 'continuous' | 'discrete' | 'binary' | 'categorical';
  
  /** Domain (for discrete/categorical) */
  domain?: string[] | { min: number; max: number };
  
  /** Description */
  description: string;
  
  /** Is observable */
  observable: boolean;
  
  /** Is intervention target */
  intervenable: boolean;
}

/**
 * Causal Edge - Directed relationship
 */
export interface CausalEdge {
  /** Source variable */
  source: string;
  
  /** Target variable */
  target: string;
  
  /** Relationship strength (0-1) */
  strength: number;
  
  /** Edge type */
  type: 'direct' | 'mediator' | 'confounder' | 'collider' | 'instrument';
  
  /** Is bidirectional (confounding) */
  bidirectional: boolean;
  
  /** Confidence in edge existence */
  confidence: number;
  
  /** Discovery method */
  discoveryMethod: 'expert' | 'constraint-based' | 'score-based' | 'gradient-based';
}

/**
 * Causal Graph - DAG representation
 */
export interface CausalGraph {
  /** Graph ID */
  id: string;
  
  /** Graph name */
  name: string;
  
  /** Variables (nodes) */
  variables: CausalVariable[];
  
  /** Edges (directed) */
  edges: CausalEdge[];
  
  /** Confounding paths (bidirectional) */
  confounders: Array<{ var1: string; var2: string; strength: number }>;
  
  /** Backdoor paths for adjustment */
  backdoorPaths: BackdoorPath[];
  
  /** Frontdoor paths */
  frontdoorPaths: FrontdoorPath[];
  
  /** Graph source */
  source: 'knowledge-graph' | 'discovered' | 'expert' | 'hybrid';
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Updated timestamp */
  updatedAt: Date;
}

/**
 * Backdoor Path - Path with common cause
 */
export interface BackdoorPath {
  /** Path ID */
  id: string;
  
  /** Treatment variable */
  treatment: string;
  
  /** Outcome variable */
  outcome: string;
  
  /** Nodes in path */
  nodes: string[];
  
  /** Is blocked (conditioned on) */
  blocked: boolean;
  
  /** Blocking variables */
  blockingVariables: string[];
}

/**
 * Frontdoor Path - Mediator path
 */
export interface FrontdoorPath {
  /** Path ID */
  id: string;
  
  /** Treatment */
  treatment: string;
  
  /** Outcome */
  outcome: string;
  
  /** Mediator variables */
  mediators: string[];
  
  /** Is valid frontdoor criterion */
  isValid: boolean;
}

/**
 * Causal Query - What we want to know
 */
export interface CausalQuery {
  /** Query ID */
  id: string;
  
  /** Query type */
  type: 'ate' | 'att' | 'counterfactual' | 'mediation' | 'pathway';
  
  /** Treatment/intervention */
  treatment: {
    variable: string;
    value: any;
    fromValue?: any;  // For ATT
  };
  
  /** Outcome of interest */
  outcome: {
    variable: string;
    condition?: any;
  };
  
  /** Adjustment set (blocking confounders) */
  adjustmentSet?: string[];
  
  /** Population for ATT */
  treatedPopulation?: string[];
  
  /** Counterfactual scenario */
  counterfactual?: {
    variable: string;
    actualValue: any;
    hypotheticalValue: any;
  };
}

/**
 * Causal Estimate - Result of inference
 */
export interface CausalEstimate {
  /** Estimate type */
  type: 'ate' | 'att' | 'counterfactual' | 'natural-direct' | 'natural-indirect';
  
  /** Point estimate */
  value: number;
  
  /** Confidence interval */
  confidenceInterval: {
    lower: number;
    upper: number;
    level: number;  // e.g., 0.95
  };
  
  /** Standard error */
  standardError: number;
  
  /** P-value */
  pValue: number;
  
  /** Method used */
  method: string;
  
  /** Identification strategy */
  identification: 'backdoor' | 'frontdoor' | 'instrumental-variable' | 'do-calculus';
  
  /** Adjustment set used */
  adjustmentSet: string[];
}

/**
 * Intervention - Do(X=x)
 */
export interface Intervention {
  /** Target variable */
  target: string;
  
  /** Intervention value */
  value: any;
  
  /** From value (for ATT) */
  fromValue?: any;
}

/**
 * Counterfactual Scenario
 */
export interface CounterfactualScenario {
  /** Scenario ID */
  id: string;
  
  /** Factual evidence (what actually happened) */
  factualEvidence: Record<string, any>;
  
  /** Hypothetical intervention */
  hypothetical: Intervention;
  
  /** Counterfactual outcome */
  counterfactualOutcome: {
    variable: string;
    expectedValue: number;
    confidenceInterval: [number, number];
  };
  
  /** Explanation */
  explanation: string;
}

/**
 * Root Cause Analysis Result
 */
export interface RootCauseAnalysis {
  /** Analysis ID */
  id: string;
  
  /** Outcome that occurred */
  outcome: {
    variable: string;
    value: any;
    expectedValue?: any;
    deviation: number;
  };
  
  /** Potential root causes */
  rootCauses: Array<{
    variable: string;
    contribution: number;  // 0-1
    evidence: string;
    counterfactual: string;
  }>;
  
  /** Causal chains leading to outcome */
  causalChains: string[][];
  
  /** Recommended interventions */
  recommendations: Array<{
    intervention: Intervention;
    expectedOutcome: number;
    confidence: number;
  }>;
}

/**
 * Mediation Analysis
 */
export interface MediationAnalysis {
  /** Total effect */
  totalEffect: number;
  
  /** Direct effect (not through mediators) */
  directEffect: number;
  
  /** Indirect effect (through mediators) */
  indirectEffect: number;
  
  /** Proportion mediated */
  proportionMediated: number;
  
  /** Mediator-specific effects */
  mediatorEffects: Array<{
    mediator: string;
    effect: number;
    proportion: number;
  }>;
}

/**
 * Do-Calculus Rules Application
 */
export interface DoCalculusStep {
  /** Step number */
  step: number;
  
  /** Rule applied (1, 2, or 3) */
  rule: 1 | 2 | 3;
  
  /** Description */
  description: string;
  
  /** Before expression */
  before: string;
  
  /** After expression */
  after: string;
  
  /** Justification */
  justification: string;
}

/**
 * Propensity Score Matching
 */
export interface PropensityScoreMatch {
  /** Matched pairs */
  pairs: Array<{
    treated: string;
    control: string;
    propensityScore: number;
    weight: number;
  }>;
  
  /** Balance statistics */
  balanceStats: Record<string, {
    before: number;
    after: number;
  }>;
  
  /** Quality metrics */
  quality: {
    avgDistance: number;
    unmatchedCount: number;
    matchingRate: number;
  };
}

/**
 * Causal Discovery Result
 */
export interface CausalDiscoveryResult {
  /** Discovered graph */
  graph: CausalGraph;
  
  /** Discovery method */
  method: 'pc' | 'fci' | 'ges' | 'lin-gam' | 'notears';
  
  /** Assumptions made */
  assumptions: string[];
  
  /** Independence tests performed */
  testCount: number;
  
  /** Score/BIC for discovered graph */
  score: number;
  
  /** Uncertainty edges */
  uncertainty: Array<{
    edge: [string, string];
    confidence: number;
    possibleDirections: string[];
  }>;
}

/**
 * Causal Reasoning Service Configuration
 */
export interface CausalConfig {
  /** Default confidence level */
  confidenceLevel: number;
  
  /** Minimum edge strength for discovery */
  minEdgeStrength: number;
  
  /** Propensity score matching caliper */
  psCaliper: number;
  
  /** Maximum backdoor path length */
  maxPathLength: number;
  
  /** Enable bootstrapping for CI */
  enableBootstrap: boolean;
  
  /** Bootstrap samples */
  bootstrapSamples: number;
  
  /** Enable sensitivity analysis */
  enableSensitivity: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_CAUSAL_CONFIG: CausalConfig = {
  confidenceLevel: 0.95,
  minEdgeStrength: 0.1,
  psCaliper: 0.2,
  maxPathLength: 10,
  enableBootstrap: true,
  bootstrapSamples: 1000,
  enableSensitivity: true
};

/**
 * Causal Reasoning Error Types
 */
export enum CausalErrorType {
  IDENTIFICATION_FAILED = 'identification_failed',
  ADJUSTMENT_SET_INVALID = 'adjustment_set_invalid',
  NO_CAUSAL_PATH = 'no_causal_path',
  CYCLIC_GRAPH = 'cyclic_graph',
  INSUFFICIENT_DATA = 'insufficient_data',
  UNOBSERVED_CONFOUNDER = 'unobserved_confounder',
  COUNTERFACTUAL_IMPOSSIBLE = 'counterfactual_impossible',
  UNKNOWN = 'unknown'
}

/**
 * Causal Reasoning Error
 */
export class CausalError extends Error {
  constructor(
    public type: CausalErrorType,
    message: string,
    public queryId?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'CausalError';
  }
}

/**
 * Service Metrics
 */
export interface CausalMetrics {
  /** Total queries processed */
  totalQueries: number;
  
  /** Successful estimations */
  successfulEstimates: number;
  
  /** Failed estimations */
  failedEstimates: number;
  
  /** Average processing time */
  avgProcessingTimeMs: number;
  
  /** Graph discoveries performed */
  discoveriesPerformed: number;
  
  /** Root cause analyses */
  rootCauseAnalyses: number;
  
  /** Counterfactuals computed */
  counterfactualsComputed: number;
}

/**
 * Causal Reasoning Events
 */
export type CausalEvent =
  | { type: 'causal.graph_discovered'; payload: { graphId: string; variables: number; edges: number } }
  | { type: 'causal.query_processed'; payload: { queryId: string; estimate: number; method: string } }
  | { type: 'causal.counterfactual_computed'; payload: { scenarioId: string; outcome: number } }
  | { type: 'causal.root_cause_found'; payload: { analysisId: string; causes: number } };
