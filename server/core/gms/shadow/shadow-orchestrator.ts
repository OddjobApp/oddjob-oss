/**
 * Shadow Orchestrator
 * 
 * Coordinates the full shadow validation pipeline:
 * 
 * 1. SELECT: Choose candidates from PMI synthesis for validation
 * 2. GENERATE: Create synthetic test data
 * 3. EXECUTE: Run in isolated sandboxes (parallel)
 * 4. COLLECT: Gather ground truth results
 * 5. COMPARE: Match predictions vs actuals
 * 6. UPDATE: Feed results back to verifier training
 * 
 * Integration with PMI:
 * - PMI generates candidates with predicted scores
 * - Shadow validates top candidates with ground truth
 * - Results improve verifier accuracy over time
 */

import { createLogger } from "../../../utils/logger.js";
import { ShadowExecutor, createShadowExecutor } from "./shadow-executor.js";
import { SyntheticDataGenerator, createSyntheticDataGenerator } from "./synthetic-data.js";
import { GroundTruthCollector, createGroundTruthCollector } from "./ground-truth.js";
import type { MissionVerifier } from "../verifier/mission-verifier.js";
import type { 
  BlueprintCandidate, 
  ShadowResult,
  ShadowRunConfig,
  SynthesizeRequest
} from "../common/types.js";
import { predictionMarketService } from "../../../domain/prediction-intelligence/prediction/prediction-market.service.js";

const logger = createLogger("ShadowOrchestrator");

export interface ShadowOrchestratorConfig {
  // Validation thresholds
  minVerifierScore: number;      // Only shadow candidates above this
  maxCandidatesPerBatch: number;
  
  // Execution settings
  variationsPerCandidate: number;  // N parallel runs
  isolationLevel: "process" | "container" | "vm";
  maxConcurrentRuns: number;
  
  // Data generation
  syntheticDataMethod: "schema_based" | "differential_privacy";
  preservePrivacy: boolean;
  
  // Feedback
  autoUpdateVerifier: boolean;     // Retrain on new data?
  updateThreshold: number;         // Min new observations before update
}

const DEFAULT_CONFIG: ShadowOrchestratorConfig = {
  minVerifierScore: 0.7,
  maxCandidatesPerBatch: 5,
  variationsPerCandidate: 10,
  isolationLevel: "process",
  maxConcurrentRuns: 5,
  syntheticDataMethod: "schema_based",
  preservePrivacy: true,
  autoUpdateVerifier: true,
  updateThreshold: 50
};

/**
 * Shadow validation batch result
 */
export interface ShadowBatchResult {
  batchId: string;
  timestamp: Date;
  candidates: Array<{
    candidate: BlueprintCandidate;
    shadowResult: ShadowResult;
    predictionDelta: number;      // |predicted - actual|
    validated: boolean;           // Meets deployment threshold?
  }>;
  summary: {
    totalCandidates: number;
    validatedCount: number;
    avgPredictionDelta: number;
    totalCost: number;
    duration: number;
  };
}

/**
 * Shadow Orchestrator
 * 
 * Manages end-to-end shadow validation for mission candidates.
 */
export class ShadowOrchestrator {
  private config: ShadowOrchestratorConfig;
  private executor: ShadowExecutor;
  private dataGenerator: SyntheticDataGenerator;
  private groundTruth: GroundTruthCollector;
  private verifier: MissionVerifier;
  
  private batchHistory: ShadowBatchResult[] = [];
  private pendingObservations: number = 0;

  constructor(
    verifier: MissionVerifier,
    config: Partial<ShadowOrchestratorConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.verifier = verifier;
    
    // Initialize components
    this.executor = createShadowExecutor({
      isolationLevel: this.config.isolationLevel,
      maxConcurrentRuns: this.config.maxConcurrentRuns
    });
    
    this.dataGenerator = createSyntheticDataGenerator({
      method: this.config.syntheticDataMethod,
      preserveCardinality: true,
      addNoise: this.config.preservePrivacy
    });
    
    this.groundTruth = createGroundTruthCollector(10000);
    
    logger.info("Shadow Orchestrator initialized", {
      variations: this.config.variationsPerCandidate,
      isolation: this.config.isolationLevel
    });
  }

  /**
   * Validate candidates with shadow runs
   * 
   * Main entry point for Phase 3 shadow validation.
   */
  async validateCandidates(
    candidates: BlueprintCandidate[],
    requestContext?: SynthesizeRequest,
    options: {
      variationsPerCandidate?: number;
      isolationLevel?: "process" | "container" | "vm";
    } = {}
  ): Promise<ShadowBatchResult> {
    const startTime = Date.now();
    const batchId = `shadow_${Date.now()}`;
    
    logger.info(`Starting shadow validation batch ${batchId}`, {
      candidates: candidates.length
    });
    
    // 1. Filter candidates by verifier score
    const eligible = candidates.filter(c => 
      (c.verifierScore?.successProbability || 0) >= this.config.minVerifierScore
    );
    
    if (eligible.length === 0) {
      logger.warn("No candidates meet minimum verifier score threshold");
      return this.createEmptyResult(batchId);
    }
    
    // 2. Limit batch size
    const toValidate = eligible.slice(0, this.config.maxCandidatesPerBatch);
    
    // 3. Generate synthetic data for each
    const testData = await this.generateTestData(toValidate, requestContext);
    
    // 4. Execute shadow runs in parallel
    const results: Array<{
      candidate: BlueprintCandidate;
      shadowResult: ShadowResult;
    }> = [];
    
    for (const candidate of toValidate) {
      try {
        // Run Prediction Market before shadow execution
        let market;
        try {
          const prompt = candidate.request || candidate.blueprint.description || `Validate candidate blueprint: ${candidate.blueprint.name}`;
          const orgId = requestContext?.context?.organizationId;
          const jobId = candidate.blueprint.steps?.[0]?.agentId ? parseInt(candidate.blueprint.steps[0].agentId) : undefined;
          
          market = await predictionMarketService.runMarket(candidate.id, prompt, {
            orgId,
            jobId
          });
        } catch (marketErr: any) {
          logger.warn(`Failed to run prediction market for candidate ${candidate.id}: ${marketErr.message}`);
        }

        const shadowResult = await this.executor.execute(candidate, {
          nVariations: options.variationsPerCandidate || this.config.variationsPerCandidate,
          isolationLevel: options.isolationLevel || this.config.isolationLevel,
          recordHermesTraces: true,
          syntheticDataConfig: {
            method: this.config.syntheticDataMethod,
            preserveCardinality: true,
            addNoise: this.config.preservePrivacy
          }
        });
        
        results.push({ candidate, shadowResult });
        
        // Resolve Prediction Market based on shadow execution outcome
        if (market) {
          try {
            const actualSuccess = shadowResult.successRate >= 0.8;
            await predictionMarketService.resolveMarket(candidate.id, actualSuccess);
          } catch (resolveErr: any) {
            logger.warn(`Failed to resolve prediction market for candidate ${candidate.id}: ${resolveErr.message}`);
          }
        }

        // 5. Record ground truth
        if (candidate.verifierScore) {
          this.groundTruth.record(
            candidate.id,
            candidate.verifierScore,
            shadowResult,
            candidate.blueprint.name
          );
          this.pendingObservations++;
        }
        
      } catch (error) {
        logger.error(`Shadow execution failed for ${candidate.id}:`, error);
      }
    }
    
    // 6. Build result
    const validatedResults = results.map(r => {
      const predictionDelta = Math.abs(
        (r.candidate.verifierScore?.successProbability || 0.5) - 
        r.shadowResult.successRate
      );
      
      // Validated if shadow success rate is acceptable
      const validated = r.shadowResult.successRate >= 0.8;
      
      return {
        candidate: r.candidate,
        shadowResult: r.shadowResult,
        predictionDelta,
        validated
      };
    });
    
    const batchResult: ShadowBatchResult = {
      batchId,
      timestamp: new Date(),
      candidates: validatedResults,
      summary: {
        totalCandidates: toValidate.length,
        validatedCount: validatedResults.filter(r => r.validated).length,
        avgPredictionDelta: validatedResults.reduce((s, r) => s + r.predictionDelta, 0) / 
                           validatedResults.length,
        totalCost: validatedResults.reduce((s, r) => s + r.shadowResult.totalCost, 0),
        duration: Date.now() - startTime
      }
    };
    
    this.batchHistory.push(batchResult);
    
    // 7. Trigger verifier update if enough data
    if (this.config.autoUpdateVerifier && 
        this.pendingObservations >= this.config.updateThreshold) {
      await this.updateVerifier();
    }
    
    logger.info(`Shadow batch ${batchId} complete`, {
      validated: batchResult.summary.validatedCount,
      avgDelta: batchResult.summary.avgPredictionDelta.toFixed(3),
      duration: batchResult.summary.duration
    });
    
    return batchResult;
  }

  /**
   * Quick validate single candidate
   * 
   * For rapid validation of a specific blueprint.
   */
  async quickValidate(candidate: BlueprintCandidate): Promise<{
    validated: boolean;
    shadowResult: ShadowResult;
    recommendation: "proceed" | "revise" | "reject";
  }> {
    logger.debug(`Quick validation for ${candidate.id}`);
    
    // Run Prediction Market
    let market;
    try {
      const prompt = candidate.request || candidate.blueprint.description || `Validate candidate blueprint: ${candidate.blueprint.name}`;
      market = await predictionMarketService.runMarket(candidate.id, prompt);
    } catch (marketErr: any) {
      logger.warn(`Failed to run prediction market for candidate ${candidate.id}: ${marketErr.message}`);
    }

    // Run with fewer variations for speed
    const shadowResult = await this.executor.execute(candidate, {
      nVariations: 5,
      isolationLevel: "process",
      recordHermesTraces: false
    });
    
    // Resolve market
    if (market) {
      try {
        const actualSuccess = shadowResult.successRate >= 0.8;
        await predictionMarketService.resolveMarket(candidate.id, actualSuccess);
      } catch (resolveErr: any) {
        logger.warn(`Failed to resolve prediction market for candidate ${candidate.id}: ${resolveErr.message}`);
      }
    }

    // Record ground truth
    if (candidate.verifierScore) {
      this.groundTruth.record(candidate.id, candidate.verifierScore, shadowResult, candidate.blueprint.name);
    }
    
    // Determine recommendation
    let recommendation: "proceed" | "revise" | "reject";
    
    if (shadowResult.successRate >= 0.9) {
      recommendation = "proceed";
    } else if (shadowResult.successRate >= 0.6) {
      recommendation = "revise";
    } else {
      recommendation = "reject";
    }
    
    return {
      validated: shadowResult.successRate >= 0.8,
      shadowResult,
      recommendation
    };
  }

  /**
   * Get ground truth metrics
   */
  getGroundTruthMetrics() {
    return {
      ...this.groundTruth.getSummary(),
      calibration: this.groundTruth.calculateMetrics(),
      surprises: this.groundTruth.getSurprises("medium")
    };
  }

  /**
   * Get batch history
   */
  getBatchHistory(): ShadowBatchResult[] {
    return [...this.batchHistory];
  }

  /**
   * Get orchestrator status
   */
  getStatus(): {
    config: ShadowOrchestratorConfig;
    executorStatus: { activeRuns: number };
    groundTruthSummary: ReturnType<GroundTruthCollector["getSummary"]>
    pendingObservations: number;
  } {
    return {
      config: this.config,
      executorStatus: this.executor.getStatus(),
      groundTruthSummary: this.groundTruth.getSummary(),
      pendingObservations: this.pendingObservations
    };
  }

  /**
   * Abort all active shadow runs
   */
  async abortAll(): Promise<void> {
    await this.executor.abortAll();
    logger.info("All shadow runs aborted");
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Generate test data for candidates
   */
  private async generateTestData(
    candidates: BlueprintCandidate[],
    context?: SynthesizeRequest
  ): Promise<Map<string, any[]>> {
    const data = new Map<string, any[]>();
    
    for (const candidate of candidates) {
      const schema = candidate.blueprint.inputSchema as any;
      
      if (schema && schema.type) {
        const samples = await this.dataGenerator.generateFromSchema(
          schema,
          this.config.variationsPerCandidate
        );
        data.set(candidate.id, samples);
      } else {
        // Generate generic data
        data.set(candidate.id, Array(this.config.variationsPerCandidate).fill({}));
      }
    }
    
    return data;
  }

  /**
   * Update verifier with ground truth data
   */
  private async updateVerifier(): Promise<void> {
    logger.info(`Updating verifier with ${this.pendingObservations} new observations`);

    const trainingData = this.groundTruth.exportForTraining();
    const toUpdate = trainingData.slice(-this.pendingObservations);

    for (const observation of toUpdate) {
      // Build a minimal synthetic trace from prediction metadata for online calibration.
      const syntheticTrace = {
        parsed: { thought: "", toolCalls: [], content: "" },
        traceId: `synthetic_${Date.now()}`,
        startTime: new Date(),
        endTime: new Date(),
        latencyMs: 0,
        tokenUsage: { total: 0, prompt: 0, completion: 0 },
        features: {
          thoughtDepth: 0,
          toolDiversity: 0,
          selfReflectionIndicators: [] as string[],
          confidenceMarkers: 0,
          recursionDepth: 0,
          actionChaining: 0
        }
      } as any;

      await this.verifier.updateFromResult(syntheticTrace, observation.actualOutcome);
    }

    this.pendingObservations = 0;

    logger.info(`Verifier calibration updated with ${toUpdate.length} shadow observations`);
  }

  /**
   * Create empty result for no-op case
   */
  private createEmptyResult(batchId: string): ShadowBatchResult {
    return {
      batchId,
      timestamp: new Date(),
      candidates: [],
      summary: {
        totalCandidates: 0,
        validatedCount: 0,
        avgPredictionDelta: 0,
        totalCost: 0,
        duration: 0
      }
    };
  }
}

/**
 * Factory function
 */
export function createShadowOrchestrator(
  verifier: MissionVerifier,
  config?: Partial<ShadowOrchestratorConfig>
): ShadowOrchestrator {
  return new ShadowOrchestrator(verifier, config);
}
