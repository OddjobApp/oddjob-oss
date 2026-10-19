/**
 * PMI Engine (Predictive Mission Intelligence)
 * 
 * Orchestrates the full counterfactual mission synthesis pipeline:
 * 
 * 1. GENERATE: LLM proposes N diverse blueprint candidates
 * 2. SIMULATE: Counterfactual execution predicts outcomes
 * 3. SCORE: Neural verifier evaluates each candidate
 * 4. RANK: Multi-objective optimization selects top-K
 * 5. RETURN: Candidates with confidence scores for user selection
 * 
 * Research basis:
 * - Tree of Thoughts: Explore diverse reasoning paths
 * - FunSearch: LLM proposes, verifier scores, best retained
 * - AlphaZero-style MCTS: Simulation-based evaluation
 */

import { createLogger } from "../../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";
import { BlueprintGenerator, createBlueprintGenerator } from "../synthesis/blueprint-generator.js";
import { CounterfactualSimulator, createCounterfactualSimulator } from "../simulation/cf-simulator.js";
import { BranchEvaluator, createBranchEvaluator, type EvaluatedCandidate } from "./branch-evaluator.js";
import type { MissionVerifier } from "../verifier/mission-verifier.js";
import type { 
  SynthesizeRequest, 
  SynthesizeResponse,
  BlueprintCandidate 
} from "../common/types.js";

const logger = createLogger("PMIEngine");

export interface PMIEngineConfig {
  // Generation
  nCandidates: number;        // How many to generate (default 20)
  
  // Simulation
  nScenarios: number;         // Simulations per candidate (default 3)
  simulationDepth: number;    // Max steps to simulate
  
  // Evaluation
  topK: number;              // How many to return (default 5)
  minSuccessProbability: number;
  
  // Performance
  parallelGeneration: boolean;
  cacheResults: boolean;
}

const DEFAULT_CONFIG: PMIEngineConfig = {
  nCandidates: 20,
  nScenarios: 3,
  simulationDepth: 50,
  topK: 5,
  minSuccessProbability: 0.6,
  parallelGeneration: true,
  cacheResults: true
};

/**
 * PMI Engine
 * 
 * The core orchestrator for Phase 2 counterfactual mission synthesis.
 */
export class PMIEngine {
  private config: PMIEngineConfig;
  private verifier: MissionVerifier;
  private generator?: BlueprintGenerator;
  private simulator?: CounterfactualSimulator;
  private evaluator?: BranchEvaluator;
  
  // Result cache
  private cache: Map<string, SynthesizeResponse> = new Map();

  constructor(
    verifier: MissionVerifier,
    config: Partial<PMIEngineConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verifier = verifier;
  }

  /**
   * Initialize PMI Engine components
   */
  async initialize(): Promise<void> {
    logger.info("Initializing PMI Engine...");
    
    // Initialize generator
    this.generator = await createBlueprintGenerator({
      nCandidates: this.config.nCandidates,
      temperature: 0.8
    });
    
    // Initialize simulator
    this.simulator = createCounterfactualSimulator({
      maxSimulationDepth: this.config.simulationDepth,
      toolSuccessModel: "realistic"
    });
    
    // Initialize evaluator
    this.evaluator = createBranchEvaluator(
      this.verifier,
      this.simulator,
      {
        topK: this.config.topK,
        minSuccessProbability: this.config.minSuccessProbability
      }
    );
    
    logger.info("PMI Engine initialized");
  }

  /**
   * Synthesize mission candidates
   * 
   * Main entry point for counterfactual mission synthesis.
   * 
   * Flow:
   * 1. Generate diverse blueprints from user request
   * 2. Simulate each blueprint (n scenarios)
   * 3. Score with neural verifier
   * 4. Rank and select top-K
   * 5. Return with confidence scores
   */
  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResponse> {
    const startTime = Date.now();
    
    // Check cache
    const cacheKey = this.getCacheKey(request);
    if (this.config.cacheResults && this.cache.has(cacheKey)) {
      logger.debug("Returning cached synthesis result");
      return this.cache.get(cacheKey)!;
    }
    
    logger.info(`Synthesizing missions for: "${request.request.substring(0, 100)}..."`);
    
    // Validate initialization
    if (!this.generator || !this.simulator || !this.evaluator) {
      throw new Error("PMI Engine not initialized. Call initialize() first.");
    }
    
    // Step 1: Generate candidates
    const candidates = await this.generator.generateCandidates(request);
    
    if (candidates.length === 0) {
      logger.warn("No candidates generated");
      return this.createEmptyResponse(request);
    }
    
    // Step 2-4: Simulate, score, rank
    const evaluation = await this.evaluator.evaluateCandidates(candidates, {
      simulate: true,
      nScenarios: this.config.nScenarios,
      topK: request.options?.topK
    });
    
    // Step 5: Build response
    const response: SynthesizeResponse = {
      requestId: cacheKey,
      candidates: evaluation.topCandidates.map(c => this.toBlueprintCandidate(c)),
      topRecommendation: evaluation.recommended ? 
        this.toBlueprintCandidate(evaluation.recommended) : 
        undefined,
      metadata: {
        generationTimeMs: Date.now() - startTime,
        modelUsed: "gemini-2.0-flash",
        tokensUsed: this.estimateTokens(candidates)
      }
    };
    
    // Cache result
    if (this.config.cacheResults) {
      this.cache.set(cacheKey, response);
      
      // Limit cache size
      if (this.cache.size > 100) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
        }
      }
    }
    
    const duration = Date.now() - startTime;
    logger.info(`Synthesis complete in ${duration}ms: ${response.candidates.length} candidates`);
    
    return response;
  }

  /**
   * Quick score a single blueprint (without full synthesis)
   */
  async quickScore(blueprint: BlueprintCandidate): Promise<{
    successProbability: number;
    estimatedLatency: number;
    estimatedCost: number;
    riskScore: number;
  }> {
    if (!this.simulator) {
      throw new Error("PMI Engine not initialized");
    }
    
    // Simulate
    const simulation = await this.simulator.simulate(blueprint, { nScenarios: 1 });
    
    // Score
    const hermesTrace = this.simulator.toHermesTrace(blueprint, simulation);
    const verifierScore = await this.verifier.scoreTrace(hermesTrace);
    
    return {
      successProbability: verifierScore.successProbability,
      estimatedLatency: simulation.duration,
      estimatedCost: verifierScore.costEstimate,
      riskScore: verifierScore.riskFactors.reduce((sum, r) => {
        const scores: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 5 };
        return sum + (scores[r.severity] || 1);
      }, 0)
    };
  }

  /**
   * Explore variations of a specific candidate
   * 
   * Useful for "I like this approach, show me variations"
   */
  async exploreVariations(
    baseCandidate: BlueprintCandidate,
    variationTypes: Array<"agent" | "tool" | "structure" | "prompt"> = ["agent", "tool"]
  ): Promise<BlueprintCandidate[]> {
    if (!this.generator) {
      throw new Error("PMI Engine not initialized");
    }
    
    logger.info(`Exploring ${variationTypes.length} variation types for candidate ${baseCandidate.id}`);
    
    // Generate variations by perturbing the base candidate
    const variations: BlueprintCandidate[] = [];
    
    for (const varType of variationTypes) {
      const varied = await this.generateVariation(baseCandidate, varType);
      if (varied) {
        variations.push(varied);
      }
    }
    
    // Evaluate variations
    if (this.evaluator && variations.length > 0) {
      const evaluation = await this.evaluator.evaluateCandidates(variations, {
        simulate: true,
        nScenarios: 2
      });
      
      return evaluation.topCandidates;
    }
    
    return variations;
  }

  /**
   * Get engine status and metrics
   */
  getStatus(): {
    initialized: boolean;
    config: PMIEngineConfig;
    cacheSize: number;
  } {
    return {
      initialized: !!(this.generator && this.simulator && this.evaluator),
      config: this.config,
      cacheSize: this.cache.size
    };
  }

  /**
   * Clear result cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug("PMI Engine cache cleared");
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  /**
   * Generate a variation of a base candidate
   */
  private async generateVariation(
    base: BlueprintCandidate,
    variationType: "agent" | "tool" | "structure" | "prompt"
  ): Promise<BlueprintCandidate | null> {
    const blueprint = { ...base.blueprint };
    
    switch (variationType) {
      case "agent":
        // Swap agent models
        if (blueprint.agents && blueprint.agents.length > 0) {
          blueprint.agents = blueprint.agents.map((a: any) => ({
            ...a,
            model: a.model === "gemini-2.0-flash" ? "gemini-2.0-pro" : "gemini-2.0-flash",
            temperature: Math.min(1, a.temperature + 0.1)
          }));
        }
        break;
        
      case "tool":
        // Add/remove tools
        if (blueprint.tools && blueprint.tools.length > 1) {
          blueprint.tools = blueprint.tools.slice(0, -1); // Remove last tool
        }
        break;
        
      case "structure":
        // Reorder independent steps
        if (blueprint.steps && blueprint.steps.length > 2) {
          const independent = blueprint.steps.filter((s: any) => !s.dependsOn || s.dependsOn.length === 0);
          if (independent.length >= 2) {
            // Swap first two independent steps
            const idx1 = blueprint.steps.indexOf(independent[0]);
            const idx2 = blueprint.steps.indexOf(independent[1]);
            [blueprint.steps[idx1], blueprint.steps[idx2]] = [blueprint.steps[idx2], blueprint.steps[idx1]];
          }
        }
        break;
        
      case "prompt":
        // Modify system prompts
        if (blueprint.agents) {
          blueprint.agents = blueprint.agents.map((a: any) => ({
            ...a,
            systemPrompt: (a.systemPrompt || "") + "\nBe thorough and verify your work."
          }));
        }
        break;
    }
    
    return {
      ...base,
      id: uuidv4(),
      blueprint,
      generation: {
        ...base.generation,
        timestamp: new Date(),
        generationMethod: "evolution",
        parentIds: [base.id],
        mutations: [{ type: variationType, description: `Varied ${variationType}` }]
      }
    };
  }

  /**
   * Convert EvaluatedCandidate to BlueprintCandidate
   */
  private toBlueprintCandidate(evaluated: EvaluatedCandidate): BlueprintCandidate {
    return {
      id: evaluated.id,
      request: evaluated.request,
      blueprint: evaluated.blueprint,
      generation: evaluated.generation,
      verifierScore: evaluated.verifierScore,
      status: "scored",
      createdAt: evaluated.createdAt
    };
  }

  /**
   * Create empty response for failed synthesis
   */
  private createEmptyResponse(request: SynthesizeRequest): SynthesizeResponse {
    return {
      requestId: this.getCacheKey(request),
      candidates: [],
      metadata: {
        generationTimeMs: 0,
        modelUsed: "none",
        tokensUsed: 0
      }
    };
  }

  /**
   * Generate cache key from request
   */
  private getCacheKey(request: SynthesizeRequest): string {
    // Simple hash of request text
    let hash = 0;
    for (let i = 0; i < request.request.length; i++) {
      const char = request.request.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    // The effective nCandidates and topK are part of the identity of the result:
    // without them, a request for topK=10 would be served the cached topK=5
    // candidate list, and the parameters would appear to work only on a cold cache.
    const resolve = (requested: unknown, fallback: number) =>
      typeof requested === "number" && Number.isInteger(requested) && requested > 0
        ? requested
        : fallback;
    const effectiveNCandidates = resolve(request.options?.nCandidates, this.config.nCandidates);
    const effectiveTopK = resolve(request.options?.topK, this.config.topK);
    return `synth_${hash}_${effectiveNCandidates}_${effectiveTopK}`;
  }

  /**
   * Estimate tokens used (rough approximation)
   */
  private estimateTokens(candidates: BlueprintCandidate[]): number {
    return candidates.reduce((sum, c) => 
      sum + c.generation.completionTokens + c.generation.promptTokens, 0
    );
  }
}

/**
 * Factory function for PMI Engine
 */
export async function createPMIEngine(
  verifier: MissionVerifier,
  config?: Partial<PMIEngineConfig>
): Promise<PMIEngine> {
  const engine = new PMIEngine(verifier, config);
  await engine.initialize();
  return engine;
}
