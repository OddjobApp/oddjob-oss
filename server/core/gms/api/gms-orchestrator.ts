/**
 * GMS Orchestrator API
 * 
 * Main entry point for Generative Mission Synthesis.
 * Coordinates all GMS subsystems:
 * - Hermes trace collection
 * - Mission verification
 * - Blueprint synthesis (Phase 2+)
 * - Shadow validation (Phase 3+)
 * - Skill evolution (Phase 4+)
 */

import { createLogger } from "../../../utils/logger.js";
import { HermesTraceCollector, DatabaseTraceStorage } from "../hermes/trace-collector.js";
import { InstrumentedHermesService } from "../hermes/instrumentation.js";
import { TraceEmbeddingEngine } from "../embeddings/trace-embedder.js";
import { MissionVerifier, PretrainedMissionVerifier } from "../verifier/mission-verifier.js";
import { VerifierTrainingPipeline, getTrainingPipeline } from "../verifier/training-pipeline.js";
import { PMIEngine, createPMIEngine } from "../pmi/pmi-engine.js";
import { ShadowOrchestrator, createShadowOrchestrator } from "../shadow/shadow-orchestrator.js";
import { SkillLibrary, createSkillLibrary } from "../skills/skill-library.js";
import { EvolutionEngine, createEvolutionEngine } from "../skills/evolution-engine.js";
import { SkillComposer, createSkillComposer } from "../skills/skill-composer.js";
import type { 
  SynthesizeRequest, 
  SynthesizeResponse,
  BlueprintCandidate,
  VerifierScore,
  Skill
} from "../common/types.js";

const logger = createLogger("GMSOrchestrator");

export interface GMSConfig {
  // Feature flags
  enabled: boolean;
  verifierEnabled: boolean;
  synthesisEnabled: boolean; // Phase 2+
  shadowEnabled: boolean;    // Phase 3+
  evolutionEnabled: boolean; // Phase 4+
  
  // Verifier settings
  verifierThreshold: number;
  minConfidenceForDeployment: number;
  
  // Instrumentation
  traceSampleRate: number;
  generateEmbeddings: boolean;
}

const DEFAULT_CONFIG: GMSConfig = {
  enabled: true,
  verifierEnabled: true,
  synthesisEnabled: true, // Phase 2+ enabled
  shadowEnabled: true,    // Phase 3+ enabled
  evolutionEnabled: true, // Phase 4+ enabled
  verifierThreshold: 0.5,
  minConfidenceForDeployment: 0.7,
  traceSampleRate: 1.0,
  generateEmbeddings: true
};

/**
 * Main GMS Orchestrator
 * 
 * Singleton service that coordinates all GMS functionality
 */
export class GMSOrchestrator {
  private config: GMSConfig;
  private db: any;
  
  // Phase 1 components
  private traceCollector?: HermesTraceCollector;
  private instrumentedHermes?: InstrumentedHermesService;
  private embedder?: TraceEmbeddingEngine;
  private verifier?: MissionVerifier;
  private trainingPipeline?: VerifierTrainingPipeline;
  
  // Phase 2 components
  private pmiEngine?: PMIEngine;
  
  // Phase 3 components
  private shadowOrchestrator?: ShadowOrchestrator;
  
  // Phase 4 components
  private skillLibrary?: SkillLibrary;
  private evolutionEngine?: EvolutionEngine;
  private skillComposer?: SkillComposer;
  
  // Initialization state
  private initialized = false;

  constructor(db: any, config: Partial<GMSConfig> = {}) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    logger.info("GMS Orchestrator created", { 
      enabled: this.config.enabled,
      verifier: this.config.verifierEnabled 
    });
  }

  /**
   * Initialize all GMS components
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info("Initializing GMS Orchestrator...");
    
    try {
      // 1. Create embedding engine
      this.embedder = new TraceEmbeddingEngine();
      
      // 2. Create trace storage
      const storage = new DatabaseTraceStorage(this.db);
      
      // 3. Create trace collector
      this.traceCollector = new HermesTraceCollector(
        storage,
        async (text) => this.embedder!.embedText(text),
        {
          enabled: this.config.enabled,
          captureThinking: true,
          captureToolCalls: true,
          generateEmbeddings: this.config.generateEmbeddings,
          sampleRate: this.config.traceSampleRate
        }
      );
      
      // 4. Create instrumented Hermes service
      this.instrumentedHermes = new InstrumentedHermesService(this.traceCollector);
      
      // 5. Initialize verifier and training pipeline
      if (this.config.verifierEnabled) {
        this.trainingPipeline = await getTrainingPipeline(
          storage,
          this.embedder,
          {
            minTrainingSamples: 100, // Lower for initial deployment
            minAccuracyForDeployment: 0.70
          }
        );
        
        this.verifier = this.trainingPipeline.getVerifier();
        
        logger.info("Verifier initialized", { 
          stats: this.trainingPipeline.getMetrics() 
        });
        
        // 6. Initialize PMI Engine (Phase 2) if synthesis enabled
        if (this.config.synthesisEnabled && this.verifier) {
          logger.info("Initializing PMI Engine (Phase 2 synthesis enabled)");
          this.pmiEngine = await createPMIEngine(this.verifier, {
            nCandidates: 15,
            topK: 5,
            nScenarios: 3
          });
          logger.info("PMI Engine initialized successfully");
        } else {
          logger.warn("PMI Engine NOT initialized", { 
            synthesisEnabled: this.config.synthesisEnabled,
            hasVerifier: !!this.verifier 
          });
        }
        
        // 7. Initialize Shadow Orchestrator (Phase 3) if shadow enabled
        if (this.config.shadowEnabled && this.verifier) {
          this.shadowOrchestrator = createShadowOrchestrator(this.verifier, {
            minVerifierScore: 0.6,
            variationsPerCandidate: 10,
            autoUpdateVerifier: true
          });
          logger.info("Shadow Orchestrator initialized (Phase 3 validation enabled)");
          
          // 8. Initialize Skill Library & Evolution Engine (Phase 4)
          if (this.config.evolutionEnabled) {
            this.skillLibrary = createSkillLibrary({ maxSkills: 500 });
            this.evolutionEngine = createEvolutionEngine(this.shadowOrchestrator);
            this.skillComposer = createSkillComposer(this.skillLibrary);
            logger.info("Skill Evolution system initialized (Phase 4 enabled)");
          }
        }
      }
      
      this.initialized = true;
      logger.info("GMS Orchestrator initialized successfully");
      
    } catch (error) {
      logger.error("Failed to initialize GMS Orchestrator:", error);
      throw error;
    }
  }

  /**
   * Phase 1: Score a mission blueprint before execution
   * 
   * Uses the neural verifier to predict success probability
   * from a Hermes reasoning trace or blueprint structure
   */
  async scoreMission(
    blueprint: any,
    options: {
      simulate?: boolean; // Run PMI simulation first
      agentContext?: any;
    } = {}
  ): Promise<VerifierScore> {
    if (!this.initialized) {
      throw new Error("GMS Orchestrator not initialized");
    }
    
    if (!this.verifier) {
      throw new Error("Verifier not enabled");
    }
    
    logger.debug("Scoring mission blueprint");
    
    // If we have a simulated trace, score it directly
    if (options.simulate && blueprint.simulatedTrace) {
      return this.verifier.scoreTrace(blueprint.simulatedTrace);
    }
    
    // Otherwise, use heuristic scoring based on blueprint structure
    return this.verifier.scoreBlueprint(blueprint);
  }

  /**
   * Phase 2: Synthesize mission candidates from request
   * 
   * Uses PMI Engine to:
   * 1. Generate diverse blueprint candidates
   * 2. Simulate execution paths
   * 3. Score with neural verifier
   * 4. Rank and return top candidates
   */
  async synthesizeMissions(
    request: SynthesizeRequest
  ): Promise<SynthesizeResponse> {
    if (!this.initialized) {
      throw new Error("GMS Orchestrator not initialized");
    }
    
    if (!this.config.synthesisEnabled || !this.pmiEngine) {
      throw new Error("Mission synthesis not enabled (set synthesisEnabled: true)");
    }
    
    logger.info("Synthesizing missions", { 
      request: request.request.substring(0, 100),
      user: request.context?.userId 
    });
    
    // Use PMI Engine for counterfactual synthesis
    const response = await this.pmiEngine.synthesize(request);
    
    logger.info(`Synthesis complete: ${response.candidates.length} candidates returned`);
    
    return response;
  }
  
  /**
   * Quick score a mission blueprint using PMI simulation
   */
  async quickScoreMission(blueprint: BlueprintCandidate): Promise<{
    successProbability: number;
    estimatedLatency: number;
    estimatedCost: number;
    riskScore: number;
  }> {
    if (!this.initialized) {
      throw new Error("GMS Orchestrator not initialized");
    }
    
    if (!this.pmiEngine) {
      throw new Error("PMI Engine not available - enable synthesis");
    }
    
    return this.pmiEngine.quickScore(blueprint);
  }
  
  /**
   * Explore variations of a candidate blueprint
   */
  async exploreVariations(
    candidate: BlueprintCandidate,
    variationTypes?: Array<"agent" | "tool" | "structure" | "prompt">
  ): Promise<BlueprintCandidate[]> {
    if (!this.initialized || !this.pmiEngine) {
      throw new Error("PMI Engine not available");
    }
    
    return this.pmiEngine.exploreVariations(candidate, variationTypes);
  }

  // ============================================================================
  // Phase 3: Shadow Validation
  // ============================================================================

  /**
   * Validate candidates with shadow runs
   * 
   * Runs blueprints in isolated sandboxes to collect ground truth
   * before production deployment.
   */
  async shadowValidate(
    candidates: BlueprintCandidate[],
    options: {
      variationsPerCandidate?: number;
      isolationLevel?: "process" | "container" | "vm";
      requestContext?: SynthesizeRequest;
    } = {}
  ): Promise<{
    batchId: string;
    validated: Array<{
      candidate: BlueprintCandidate;
      successRate: number;
      recommendation: "proceed" | "revise" | "reject";
    }>;
    groundTruthMetrics: ReturnType<ShadowOrchestrator["getGroundTruthMetrics"]>;
  }> {
    if (!this.initialized) {
      throw new Error("GMS Orchestrator not initialized");
    }
    
    if (!this.config.shadowEnabled || !this.shadowOrchestrator) {
      throw new Error("Shadow validation not enabled (set shadowEnabled: true)");
    }
    
    logger.info(`Starting shadow validation for ${candidates.length} candidates`);
    
    // We pass options to a temporary config override or just update the orchestrator
    // For now, we'll just pass the context as per the original design, but the handler wants to pass variations too.
    // Let's assume we can pass them to validateCandidates if we update it.
    const batchResult = await this.shadowOrchestrator.validateCandidates(
      candidates,
      options.requestContext,
      {
        variationsPerCandidate: options.variationsPerCandidate,
        isolationLevel: options.isolationLevel
      }
    );
    
    const validated = batchResult.candidates.map(c => {
      let recommendation: "proceed" | "revise" | "reject";
      if (c.validated && c.predictionDelta < 0.2) {
        recommendation = "proceed";
      } else if (c.shadowResult.successRate > 0.5) {
        recommendation = "revise";
      } else {
        recommendation = "reject";
      }
      
      return {
        candidate: c.candidate,
        successRate: c.shadowResult.successRate,
        recommendation
      };
    });
    
    logger.info(`Shadow validation complete: ${validated.filter(v => v.recommendation === "proceed").length} candidates approved`);
    
    return {
      batchId: batchResult.batchId,
      validated,
      groundTruthMetrics: this.shadowOrchestrator.getGroundTruthMetrics()
    };
  }

  /**
   * Quick shadow validation for single candidate
   */
  async quickShadowValidate(candidate: BlueprintCandidate): Promise<{
    validated: boolean;
    successRate: number;
    recommendation: "proceed" | "revise" | "reject";
  }> {
    if (!this.initialized || !this.shadowOrchestrator) {
      throw new Error("Shadow Orchestrator not available");
    }
    
    const result = await this.shadowOrchestrator.quickValidate(candidate);
    
    return {
      validated: result.validated,
      successRate: result.shadowResult.successRate,
      recommendation: result.recommendation
    };
  }

  // ============================================================================
  // Phase 4: Skill Evolution
  // ============================================================================

  /**
   * Register a validated blueprint as a reusable skill
   */
  registerSkill(
    candidate: BlueprintCandidate,
    shadowResult: any
  ): Skill {
    if (!this.initialized || !this.skillLibrary) {
      throw new Error("Skill Library not available (enable evolution)");
    }
    
    return this.skillLibrary.registerSkill(candidate, shadowResult, { autoTag: true });
  }

  /**
   * Find skills matching a query
   */
  async findSkills(query: string, options?: { limit?: number; minSuccessRate?: number; requiredTags?: string[] }): Promise<any[]> {
    if (!this.initialized || !this.skillLibrary) {
      throw new Error("Skill Library not available");
    }

    return this.skillLibrary.findSkills(query, options);
  }

  /**
   * Evolve a skill to improve performance
   */
  async evolveSkill(skillId: string): Promise<{
    success: boolean;
    improvement: number;
    newSkillId?: string;
  }> {
    if (!this.initialized || !this.evolutionEngine || !this.skillLibrary) {
      throw new Error("Evolution Engine not available");
    }
    
    const skill = this.skillLibrary.getSkill(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }
    
    const result = await this.evolutionEngine.evolveSkill(skill);
    
    if (result.success && result.bestVariant) {
      // Register evolved skill
      const newSkill = this.registerSkill(result.bestVariant, skill.shadowResult);
      
      // --- Latent Features Integrations ---
      try {
          import("../../../domain/prediction-intelligence/integrations/skill-lineage-integration.js").then(({ skillLineageIntegration }) => {
              skillLineageIntegration.mapSkillLineage(
                  skillId,
                  newSkill.id,
                  `Automated evolution (improvement: ${result.improvement})`,
                  "unknown-mission",
                  { organizationId: 1 } as any
              ).catch(() => {});
          }).catch(() => {});
      } catch (e) {}
      // ------------------------------------

      return {
        success: true,
        improvement: result.improvement,
        newSkillId: newSkill.id
      };
    }
    
    return { success: result.success, improvement: 0 };
  }

  /**
   * Auto-compose mission from skill library
   */
  async composeMission(goal: string): Promise<any> {
    if (!this.initialized || !this.skillComposer) {
      throw new Error("Skill Composer not available");
    }
    
    return this.skillComposer.autoCompose(goal);
  }

  /**
   * Get skill library statistics
   */
  getSkillStats(): ReturnType<SkillLibrary["getStats"]> | null {
    if (!this.skillLibrary) return null;
    return this.skillLibrary.getStats();
  }

  getShadowMetrics(): ReturnType<ShadowOrchestrator["getGroundTruthMetrics"]> | null {
    if (!this.shadowOrchestrator) return null;
    return this.shadowOrchestrator.getGroundTruthMetrics();
  }

  /**
   * Get instrumented Hermes service for trace collection
   */
  getInstrumentedHermes(): InstrumentedHermesService {
    if (!this.initialized || !this.instrumentedHermes) {
      throw new Error("GMS Orchestrator not initialized");
    }
    return this.instrumentedHermes;
  }

  /**
   * Get verifier for direct scoring
   */
  getVerifier(): MissionVerifier {
    if (!this.initialized || !this.verifier) {
      throw new Error("Verifier not available");
    }
    return this.verifier;
  }

  /**
   * Get trace collector for manual instrumentation
   */
  getTraceCollector(): HermesTraceCollector {
    if (!this.initialized || !this.traceCollector) {
      throw new Error("Trace collector not available");
    }
    return this.traceCollector;
  }

  /**
   * Record mission outcome for verifier training
   */
  async recordOutcome(
    traceId: string,
    outcome: { success: boolean; executionTime?: number; error?: string }
  ): Promise<void> {
    if (!this.initialized || !this.traceCollector) {
      throw new Error("GMS Orchestrator not initialized");
    }
    
    await this.traceCollector.updateOutcome(traceId, outcome);
    
    const trace = await this.traceCollector.getEnrichedTrace(traceId);
    
    // Also update training pipeline for online learning
    if (this.trainingPipeline && outcome.executionTime && trace) {
      await this.trainingPipeline.onlineUpdate(trace, outcome.success);
    }

    // Trigger offline evolution loop if enabled and outcome is successful
    if (this.config.evolutionEnabled && outcome.success && trace && (trace as any).skillId) {
      logger.info(`[GMSOrchestrator] Triggering evolution for successful trace: ${traceId} (Skill: ${(trace as any).skillId})`);
      this.evolveSkill((trace as any).skillId).catch(err => {
        logger.error(`Failed to evolve skill ${(trace as any).skillId}:`, err);
      });
    }
  }

  /**
   * Trigger manual verifier retraining
   */
  async retrainVerifier(): Promise<{
    success: boolean;
    accuracy: number;
    deployed: boolean;
  }> {
    if (!this.initialized || !this.trainingPipeline) {
      throw new Error("Training pipeline not available");
    }
    
    logger.info("Triggering manual verifier retraining");
    const result = await this.trainingPipeline.runTraining();
    
    // Update verifier reference if deployment succeeded
    if (result.deployed) {
      this.verifier = this.trainingPipeline.getVerifier();
    }
    
    return {
      success: result.success,
      accuracy: result.metrics.accuracy,
      deployed: result.deployed
    };
  }

  /**
   * Get GMS health and status
   */
  getStatus(): {
    initialized: boolean;
    config: GMSConfig;
    verifier: {
      available: boolean;
      accuracy: number;
      totalPredictions: number;
    } | null;
    pmi: {
      available: boolean;
      cacheSize: number;
    } | null;
    shadow: {
      available: boolean;
      groundTruthObservations: number;
    } | null;
    traces: {
      collectorEnabled: boolean;
      sampleRate: number;
    };
  } {
    return {
      initialized: this.initialized,
      config: this.config,
      verifier: this.trainingPipeline ? {
        available: !!this.verifier,
        accuracy: this.trainingPipeline.getMetrics().currentAccuracy,
        totalPredictions: this.trainingPipeline.getMetrics().totalPredictions
      } : null,
      pmi: this.pmiEngine ? {
        available: true,
        cacheSize: this.pmiEngine.getStatus().cacheSize
      } : null,
      shadow: this.shadowOrchestrator ? {
        available: true,
        groundTruthObservations: this.shadowOrchestrator.getStatus().groundTruthSummary.totalObservations
      } : null,
      traces: {
        collectorEnabled: !!this.traceCollector,
        sampleRate: this.config.traceSampleRate
      }
    };
  }

  /**
   * Dispose and cleanup
   */
  async dispose(): Promise<void> {
    if (this.traceCollector) {
      await this.traceCollector.dispose();
    }
    this.initialized = false;
    logger.info("GMS Orchestrator disposed");
  }
}

/**
 * Singleton instance
 */
let orchestratorInstance: GMSOrchestrator | null = null;
let initializationPromise: Promise<GMSOrchestrator> | null = null;

export async function getGMSOrchestrator(
  db?: any,
  config?: Partial<GMSConfig>
): Promise<GMSOrchestrator> {
  if (orchestratorInstance) return orchestratorInstance;

  if (db) {
    if (!initializationPromise) {
      initializationPromise = (async () => {
        const instance = new GMSOrchestrator(db, config);
        await instance.initialize();
        orchestratorInstance = instance;
        return instance;
      })();
    }
    return initializationPromise;
  }

  throw new Error("GMS Orchestrator not initialized - provide db instance");
}

/**
 * Reset singleton (for testing)
 */
export async function resetGMSOrchestrator(): Promise<void> {
  if (orchestratorInstance) {
    await orchestratorInstance.dispose();
    orchestratorInstance = null;
  }
  initializationPromise = null;
}
