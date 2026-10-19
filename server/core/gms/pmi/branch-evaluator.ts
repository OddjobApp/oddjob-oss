/**
 * Branch Evaluator
 * 
 * Ranks and filters blueprint candidates after simulation.
 * 
 * Responsibilities:
 * - Run verifier on simulated traces
 * - Calculate aggregate scores (success prob, latency, cost, risk)
 * - Rank candidates by composite score
 * - Select top-K for shadow validation
 * - Identify Pareto-optimal candidates
 * 
 * Scoring formula:
 * score = w1 * successProbability + w2 * (1/latency) + w3 * (1/cost) - w4 * riskScore
 */

import { createLogger } from "../../../utils/logger.js";
import type { MissionVerifier } from "../verifier/mission-verifier.js";
import type { CounterfactualSimulator } from "../simulation/cf-simulator.js";
import type { 
  BlueprintCandidate,
  VerifierScore,
  SimulationResult
} from "../common/types.js";

const logger = createLogger("BranchEvaluator");

export interface EvaluatorConfig {
  // Weights for composite score
  weights: {
    successProbability: number;
    latency: number;      // Inverted (lower is better)
    cost: number;         // Inverted (lower is better)
    risk: number;         // Subtracted (lower is better)
    confidence: number;   // Direct (higher is better)
  };
  
  // Selection criteria
  topK: number;              // How many to select
  minSuccessProbability: number;
  maxLatency: number;        // ms
  maxCost: number;           // $
  maxRiskScore: number;
  
  // Diversity enforcement
  enforceDiversity: boolean;
  diversityThreshold: number; // Min difference between selected candidates
}

const DEFAULT_CONFIG: EvaluatorConfig = {
  weights: {
    successProbability: 0.4,
    latency: 0.15,
    cost: 0.15,
    risk: 0.15,
    confidence: 0.15
  },
  topK: 5,
  minSuccessProbability: 0.6,
  maxLatency: 30000,  // 30 seconds
  maxCost: 1.0,       // $1
  maxRiskScore: 5,
  enforceDiversity: true,
  diversityThreshold: 0.2
};

/**
 * Evaluated candidate with full scoring
 */
export interface EvaluatedCandidate extends BlueprintCandidate {
  simulation: SimulationResult;
  verifierScore: VerifierScore;
  compositeScore: number;
  rank: number;
  paretoOptimal: boolean;
  recommended: boolean;
}

/**
 * Branch Evaluator
 * 
 * Ranks blueprint candidates using multi-objective scoring.
 */
export class BranchEvaluator {
  private config: EvaluatorConfig;
  private verifier: MissionVerifier;
  private simulator: CounterfactualSimulator;
  
  constructor(
    verifier: MissionVerifier,
    simulator: CounterfactualSimulator,
    config: Partial<EvaluatorConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verifier = verifier;
    this.simulator = simulator;
  }

  /**
   * Evaluate and rank candidates
   * 
   * Main entry point for Phase 2 evaluation.
   */
  async evaluateCandidates(
    candidates: BlueprintCandidate[],
    options: {
      simulate?: boolean;  // Run simulation first
      nScenarios?: number;   // Scenarios per simulation
      /** Overrides the configured topK for this call. Must be a positive integer. */
      topK?: number;
    } = {}
  ): Promise<{
    evaluated: EvaluatedCandidate[];
    topCandidates: EvaluatedCandidate[];
    recommended: EvaluatedCandidate | null;
    rejected: BlueprintCandidate[];
    metrics: EvaluationMetrics;
  }> {
    logger.info(`Evaluating ${candidates.length} candidates`);
    
    const startTime = Date.now();
    
    // 1. Simulate each candidate if requested
    let simulated: Array<{ candidate: BlueprintCandidate; simulation: SimulationResult }> = [];
    
    if (options.simulate !== false) {
      simulated = await this.simulateCandidates(candidates, options.nScenarios || 3);
    } else {
      // Use placeholder simulations
      simulated = candidates.map(c => ({
        candidate: c,
        simulation: this.createPlaceholderSimulation(c)
      }));
    }
    
    // 2. Score with verifier
    const scored = await this.scoreCandidates(simulated);
    
    // 3. Filter by hard constraints
    const { passed, rejected } = this.filterByConstraints(scored);
    
    // 4. Calculate composite scores
    const scoredWithComposite = this.calculateCompositeScores(passed);
    
    // 5. Identify Pareto-optimal candidates
    const withPareto = this.identifyParetoFrontier(scoredWithComposite);
    
    // 6. Rank and select top-K
    const ranked = this.rankCandidates(withPareto);
    // A per-call override wins over the engine default. Guarded because slice()
    // treats 0 and negatives as "empty" or "drop from the end" rather than an
    // error, which would silently return the wrong candidate set.
    const requestedTopK = options.topK;
    const effectiveTopK =
      typeof requestedTopK === "number" && Number.isInteger(requestedTopK) && requestedTopK > 0
        ? requestedTopK
        : this.config.topK;
    const topK = ranked.slice(0, effectiveTopK);
    
    // 7. Mark recommendation
    const recommended = topK.length > 0 ? topK[0] : null;
    if (recommended) {
      recommended.recommended = true;
    }
    
    const duration = Date.now() - startTime;
    
    logger.info(`Evaluation complete: ${topK.length} candidates selected in ${duration}ms`);
    
    // 8. Compile metrics
    const metrics = this.calculateMetrics(ranked, rejected);
    
    return {
      evaluated: ranked,
      topCandidates: topK,
      recommended,
      rejected: rejected.map(r => r.candidate),
      metrics
    };
  }

  /**
   * Simulate all candidates
   */
  private async simulateCandidates(
    candidates: BlueprintCandidate[],
    nScenarios: number
  ): Promise<Array<{ candidate: BlueprintCandidate; simulation: SimulationResult }>> {
    const results: Array<{ candidate: BlueprintCandidate; simulation: SimulationResult }> = [];
    
    for (const candidate of candidates) {
      try {
        const simulation = await this.simulator.simulate(candidate, { nScenarios });
        results.push({ candidate, simulation });
      } catch (error) {
        logger.warn(`Simulation failed for ${candidate.id}:`, undefined, error);
        // Add with failed simulation
        results.push({
          candidate,
          simulation: this.createFailedSimulation()
        });
      }
    }
    
    return results;
  }

  /**
   * Score candidates with verifier
   */
  private async scoreCandidates(
    simulated: Array<{ candidate: BlueprintCandidate; simulation: SimulationResult }>
  ): Promise<Array<{ 
    candidate: BlueprintCandidate; 
    simulation: SimulationResult;
    verifierScore: VerifierScore;
  }>> {
    const results = [];
    
    for (const { candidate, simulation } of simulated) {
      try {
        // Convert simulation to Hermes trace
        const hermesTrace = this.simulator.toHermesTrace(candidate, simulation);
        
        // Score with verifier
        const verifierScore = await this.verifier.scoreTrace(hermesTrace);
        
        results.push({ candidate, simulation, verifierScore });
      } catch (error) {
        logger.warn(`Scoring failed for ${candidate.id}:`, undefined, error);
        
        // Use placeholder score
        results.push({
          candidate,
          simulation,
          verifierScore: this.createPlaceholderScore()
        });
      }
    }
    
    return results;
  }

  /**
   * Filter candidates by hard constraints
   */
  private filterByConstraints(
    candidates: Array<{ candidate: BlueprintCandidate; simulation: SimulationResult; verifierScore: VerifierScore }>
  ): {
    passed: typeof candidates;
    rejected: typeof candidates;
  } {
    const passed: typeof candidates = [];
    const rejected: typeof candidates = [];
    
    for (const item of candidates) {
      const { verifierScore, simulation } = item;
      
      // Check success probability
      if (verifierScore.successProbability < this.config.minSuccessProbability) {
        rejected.push(item);
        continue;
      }
      
      // Check latency
      if (simulation.duration > this.config.maxLatency) {
        rejected.push(item);
        continue;
      }
      
      // Check cost
      if (verifierScore.costEstimate > this.config.maxCost) {
        rejected.push(item);
        continue;
      }
      
      // Check risk score
      const riskScore = this.calculateRiskScore(verifierScore.riskFactors);
      if (riskScore > this.config.maxRiskScore) {
        rejected.push(item);
        continue;
      }
      
      passed.push(item);
    }
    
    logger.debug(`Constraint filtering: ${passed.length} passed, ${rejected.length} rejected`);
    
    return { passed, rejected };
  }

  /**
   * Calculate composite scores
   */
  private calculateCompositeScores(
    candidates: Array<{ candidate: BlueprintCandidate; simulation: SimulationResult; verifierScore: VerifierScore }>
  ): Array<{ 
    candidate: BlueprintCandidate; 
    simulation: SimulationResult;
    verifierScore: VerifierScore;
    compositeScore: number;
  }> {
    return candidates.map(item => {
      const { verifierScore, simulation } = item;
      const { weights } = this.config;
      
      // Normalize metrics to 0-1 scale
      const successProb = verifierScore.successProbability;
      const normalizedLatency = Math.max(0, 1 - simulation.duration / this.config.maxLatency);
      const normalizedCost = Math.max(0, 1 - verifierScore.costEstimate / this.config.maxCost);
      const riskScore = Math.max(0, 1 - this.calculateRiskScore(verifierScore.riskFactors) / 10);
      const confidence = verifierScore.confidence;
      
      // Weighted sum
      const compositeScore = 
        weights.successProbability * successProb +
        weights.latency * normalizedLatency +
        weights.cost * normalizedCost +
        weights.risk * riskScore +
        weights.confidence * confidence;
      
      return { ...item, compositeScore };
    });
  }

  /**
   * Identify Pareto-optimal candidates
   * 
   * A candidate is Pareto-optimal if no other candidate dominates it
   * in all objectives (success prob, latency, cost, risk).
   */
  private identifyParetoFrontier(
    candidates: Array<{ 
      candidate: BlueprintCandidate; 
      simulation: SimulationResult;
      verifierScore: VerifierScore;
      compositeScore: number;
    }>
  ): Array<{ 
    candidate: BlueprintCandidate; 
    simulation: SimulationResult;
    verifierScore: VerifierScore;
    compositeScore: number;
    paretoOptimal: boolean;
  }> {
    return candidates.map((candidate, idx) => {
      let dominated = false;
      
      for (let i = 0; i < candidates.length; i++) {
        if (i === idx) continue;
        
        const other = candidates[i];
        
        // Check if other dominates candidate
        const betterOrEqualInAll = 
          other.verifierScore.successProbability >= candidate.verifierScore.successProbability &&
          other.simulation.duration <= candidate.simulation.duration &&
          other.verifierScore.costEstimate <= candidate.verifierScore.costEstimate &&
          this.calculateRiskScore(other.verifierScore.riskFactors) <= 
            this.calculateRiskScore(candidate.verifierScore.riskFactors);
        
        const strictlyBetterInOne = 
          other.verifierScore.successProbability > candidate.verifierScore.successProbability ||
          other.simulation.duration < candidate.simulation.duration ||
          other.verifierScore.costEstimate < candidate.verifierScore.costEstimate ||
          this.calculateRiskScore(other.verifierScore.riskFactors) < 
            this.calculateRiskScore(candidate.verifierScore.riskFactors);
        
        if (betterOrEqualInAll && strictlyBetterInOne) {
          dominated = true;
          break;
        }
      }
      
      return { ...candidate, paretoOptimal: !dominated };
    });
  }

  /**
   * Rank candidates by composite score
   */
  private rankCandidates(
    candidates: Array<{
      candidate: BlueprintCandidate;
      simulation: SimulationResult;
      verifierScore: VerifierScore;
      compositeScore: number;
      paretoOptimal: boolean;
    }>
  ): EvaluatedCandidate[] {
    // Sort by composite score (descending)
    const sorted = [...candidates].sort((a, b) => b.compositeScore - a.compositeScore);
    
    // Assign ranks and convert to EvaluatedCandidate
    return sorted.map((item, idx) => ({
      ...item.candidate,
      simulation: item.simulation,
      verifierScore: item.verifierScore,
      compositeScore: item.compositeScore,
      rank: idx + 1,
      paretoOptimal: item.paretoOptimal,
      recommended: false
    }));
  }

  /**
   * Calculate risk score from risk factors
   */
  private calculateRiskScore(riskFactors: Array<{ severity: string }>): number {
    const severityScores: Record<string, number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 5
    };
    
    return riskFactors.reduce((sum, factor) => 
      sum + (severityScores[factor.severity] || 1), 0
    );
  }

  /**
   * Calculate evaluation metrics
   */
  private calculateMetrics(
    evaluated: EvaluatedCandidate[],
    rejected: Array<{ candidate: BlueprintCandidate; simulation: SimulationResult; verifierScore: VerifierScore }>
  ): EvaluationMetrics {
    if (evaluated.length === 0) {
      return {
        totalCandidates: evaluated.length + rejected.length,
        passedConstraints: evaluated.length,
        rejectedCount: rejected.length,
        avgSuccessProbability: 0,
        avgLatency: 0,
        avgCost: 0,
        avgCompositeScore: 0,
        paretoOptimalCount: 0
      };
    }
    
    const avgSuccessProbability = evaluated.reduce((s, c) => 
      s + c.verifierScore.successProbability, 0
    ) / evaluated.length;
    
    const avgLatency = evaluated.reduce((s, c) => 
      s + c.simulation.duration, 0
    ) / evaluated.length;
    
    const avgCost = evaluated.reduce((s, c) => 
      s + c.verifierScore.costEstimate, 0
    ) / evaluated.length;
    
    const avgCompositeScore = evaluated.reduce((s, c) => 
      s + c.compositeScore, 0
    ) / evaluated.length;
    
    const paretoOptimalCount = evaluated.filter(c => c.paretoOptimal).length;
    
    return {
      totalCandidates: evaluated.length + rejected.length,
      passedConstraints: evaluated.length,
      rejectedCount: rejected.length,
      avgSuccessProbability,
      avgLatency,
      avgCost,
      avgCompositeScore,
      paretoOptimalCount
    };
  }

  /**
   * Create placeholder simulation for candidates that couldn't be simulated
   */
  private createPlaceholderSimulation(candidate: BlueprintCandidate): SimulationResult {
    const stepCount = candidate.blueprint.steps?.length || 3;
    
    return {
      trace: {
        steps: Array(stepCount).fill(null).map((_, i) => ({
          type: "action",
          content: `Step ${i + 1}`,
          estimatedLatency: 1000,
          estimatedTokens: 200,
          confidence: 0.5
        })),
        thinkingBlocks: [],
        toolCalls: []
      },
      finalState: {
        success: true,
        output: {},
        intermediateResults: {}
      },
      duration: stepCount * 1000,
      tokenEstimate: stepCount * 200
    };
  }

  /**
   * Create failed simulation placeholder
   */
  private createFailedSimulation(): SimulationResult {
    return {
      trace: {
        steps: [{
          type: "error",
          content: "Simulation failed",
          estimatedLatency: 0,
          estimatedTokens: 0,
          confidence: 0
        }],
        thinkingBlocks: [],
        toolCalls: []
      },
      finalState: {
        success: false,
        output: {},
        error: "Simulation failed",
        intermediateResults: {}
      },
      duration: 0,
      tokenEstimate: 0
    };
  }

  /**
   * Create placeholder verifier score
   */
  private createPlaceholderScore(): VerifierScore {
    return {
      successProbability: 0.5,
      confidence: 0.3,
      latencyEstimate: 5000,
      costEstimate: 0.01,
      riskFactors: []
    };
  }
}

/**
 * Evaluation metrics summary
 */
export interface EvaluationMetrics {
  totalCandidates: number;
  passedConstraints: number;
  rejectedCount: number;
  avgSuccessProbability: number;
  avgLatency: number;
  avgCost: number;
  avgCompositeScore: number;
  paretoOptimalCount: number;
}

/**
 * Factory function
 */
export function createBranchEvaluator(
  verifier: MissionVerifier,
  simulator: CounterfactualSimulator,
  config?: Partial<EvaluatorConfig>
): BranchEvaluator {
  return new BranchEvaluator(verifier, simulator, config);
}
