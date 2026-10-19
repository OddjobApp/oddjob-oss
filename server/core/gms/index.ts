/**
 * GMS (Generative Mission Synthesis) Module
 * 
 * Main exports for the GMS system.
 * 
 * Phases:
 * - Phase 1: Neural Verifier & Hermes Instrumentation ✅
 * - Phase 2: Mission Synthesis (PMI) ✅
 * - Phase 3: Shadow Validation ✅
 * - Phase 4: Skill Evolution (coming)
 */

// Core orchestrator
export { 
  GMSOrchestrator, 
  getGMSOrchestrator, 
  resetGMSOrchestrator 
} from "./api/gms-orchestrator.js";
export type { GMSConfig } from "./api/gms-orchestrator.js";

// API routes
export { default as GMSRoutes } from "./api/routes.js";

// Hermes instrumentation
export { 
  HermesTraceCollector,
  DatabaseTraceStorage,
  type TraceStorage
} from "./hermes/trace-collector.js";
export {
  InstrumentedHermesService,
  createInstrumentedHermes,
  createInstrumentedParser
} from "./hermes/instrumentation.js";

// Embeddings
export { 
  TraceEmbeddingEngine,
  MockEmbeddingEngine,
  type EmbeddingConfig
} from "./embeddings/trace-embedder.js";

// Verifier
export {
  MissionVerifier,
  PretrainedMissionVerifier
} from "./verifier/mission-verifier.js";
export {
  VerifierTrainingPipeline,
  getTrainingPipeline,
  type TrainingConfig
} from "./verifier/training-pipeline.js";

// Phase 2: PMI (Predictive Mission Intelligence)
export {
  PMIEngine,
  createPMIEngine,
  type PMIEngineConfig
} from "./pmi/pmi-engine.js";
export {
  BlueprintGenerator,
  createBlueprintGenerator,
  type GeneratorConfig
} from "./synthesis/blueprint-generator.js";
export {
  CounterfactualSimulator,
  createCounterfactualSimulator,
  type SimulatorConfig
} from "./simulation/cf-simulator.js";
export {
  BranchEvaluator,
  createBranchEvaluator,
  type EvaluatorConfig,
  type EvaluatedCandidate
} from "./pmi/branch-evaluator.js";

// Phase 3: Shadow Validation
export {
  ShadowOrchestrator,
  createShadowOrchestrator,
  type ShadowOrchestratorConfig,
  type ShadowBatchResult
} from "./shadow/shadow-orchestrator.js";
export {
  ShadowExecutor,
  createShadowExecutor,
  type ExecutorConfig
} from "./shadow/shadow-executor.js";
export {
  SyntheticDataGenerator,
  createSyntheticDataGenerator,
  type DataGeneratorConfig
} from "./shadow/synthetic-data.js";
export {
  GroundTruthCollector,
  createGroundTruthCollector,
  type GroundTruthEntry,
  type CalibrationMetrics
} from "./shadow/ground-truth.js";

// Phase 4: Skill Evolution
export {
  SkillLibrary,
  createSkillLibrary,
  type LibraryConfig,
  type SkillSearchResult
} from "./skills/skill-library.js";
export {
  EvolutionEngine,
  createEvolutionEngine,
  type EvolutionConfig
} from "./skills/evolution-engine.js";
export {
  SkillComposer,
  createSkillComposer,
  type ComposerConfig,
  type CompositionAnalysis
} from "./skills/skill-composer.js";

// Types
export type {
  // Core GMS
  BlueprintCandidate,
  MissionBlueprint,
  AgentConfig,
  ToolConfig,
  
  // Verifier
  VerifierScore,
  RiskFactor,
  
  // Shadow
  ShadowRunConfig,
  ShadowResult,
  
  // Skills
  Skill,
  SkillComposition,
  
  // API
  SynthesizeRequest,
  SynthesizeResponse,
  
  // Hermes
  EnrichedHermesTrace,
  HermesInstrumentationConfig,
  HermesTraceFeatures
} from "./common/types.js";

// Schema exports (from shared/schema)
export {
  hermesTraces,
  insertHermesTraceSchema,
  selectHermesTraceSchema,
  type HermesTrace,
  type InsertHermesTrace
} from "../../../shared/schema/gms/hermes-traces.js";

/**
 * Quick start example:
 * 
 * ```typescript
 * import { getGMSOrchestrator } from "./gms/index.js";
 * 
 * // Initialize GMS with database connection
 * const gms = await getGMSOrchestrator(db, {
 *   enabled: true,
 *   verifierEnabled: true,
 *   synthesisEnabled: true  // Enable Phase 2 PMI
 * });
 * 
 * // Phase 2: Synthesize mission candidates
 * const synthesis = await gms.synthesizeMissions({
 *   request: "Analyze Q3 sales data and create retention campaign",
 *   context: { organizationId: 123, userId: "user-456" }
 * });
 * 
 * console.log(`Top recommendation:`, synthesis.topRecommendation);
 * console.log(`Candidates:`, synthesis.candidates);
 * 
 * // Phase 1: Score a specific blueprint
 * const score = await gms.scoreMission(blueprint);
 * console.log(`Predicted success: ${score.successProbability}`);
 * 
 * // Get instrumented Hermes for trace collection
 * const instrumentedHermes = gms.getInstrumentedHermes();
 * const result = await instrumentedHermes.reason(prompt, { agentContext });
 * 
 * // Record outcome for training
 * await gms.recordOutcome(result.traceId, { success: true });
 * ```
 */

// Version
export const GMS_VERSION = "4.0.0-phase4";
export const GMS_PHASE = 4;
