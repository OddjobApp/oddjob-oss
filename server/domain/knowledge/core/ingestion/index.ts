/**
 * Ingestion Orchestrator Module
 *
 * Autonomous research ingestion system that accepts a subject (topic/URL),
 * plans a gathering strategy, executes multi-source collection, routes
 * structured output into the Knowledge Graph, Datasets, and Document
 * Templates, and streams real-time progress via SSE.
 *
 * @example
 * ```typescript
 * import { ResearchSubjectInput, GatheringStrategy, IngestionStage } from './ingestion';
 *
 * const input: ResearchSubjectInput = {
 *   value: "distributed consensus algorithms",
 *   maxSources: 15,
 *   enabledCollectors: ["web_scraper", "academic_search"]
 * };
 * ```
 */

// Core types
export type {
  ResearchSubjectInput,
  ClassifiedInput,
  SourceCollectorType,
  CollectorInvocation,
  GatheringStrategy,
  IngestionStage,
  IngestionOrchestrationResult,
  IngestionRunStatus,
  IngestionRunMetrics,
  IngestionRunSummary,
} from './types.js';

// Progress event types
export type {
  IngestionProgressEvent,
  PlanningPayload,
  CollectingPayload,
  ExtractingPayload,
  SynthesizingPayload,
  CompletedPayload,
  FailedPayload,
} from './progress.types.js';

// Context snapshot schema (pipelineExecution.contextSnapshot)
export type { IngestionContextSnapshot } from './context-snapshot.types.js';

// Collector interfaces
export type {
  CollectedContent,
  CollectorResult,
  SourceCollector,
} from './collectors/collector.interface.js';

// Input Classifier service
export { inputClassifierService } from './input-classifier.service.js';
export type { InputClassificationError } from './input-classifier.service.js';

// Strategy Planner service
export { strategyPlannerService } from './strategy-planner.service.js';

// Deduplication service
export { deduplicationService } from './deduplication.service.js';
export { cosineSimilarity } from './deduplication.service.js';
export type { EmbeddingProvider } from './deduplication.service.js';

// Collection Executor service
export { collectionExecutorService } from './collection-executor.service.js';
export type {
  CollectionExecutorOptions,
  CollectionExecutorResult,
} from './collection-executor.service.js';

// Knowledge Ingestion service
export { knowledgeIngestionService } from './knowledge-ingestion.service.js';
export type {
  KnowledgeIngestionOptions,
  KnowledgeIngestionResult,
} from './knowledge-ingestion.service.js';

// Dataset Ingestion service
export { datasetIngestionService } from './dataset-ingestion.service.js';
export type { DatasetIngestionResult } from './dataset-ingestion.service.js';

// Ingestion Orchestrator service
export { ingestionOrchestratorService } from './ingestion-orchestrator.service.js';

// App Provisioning service
export { appProvisioningService } from './app-provisioning.service.js';
export type {
  AppProvisioningLogEntry,
  AppProvisioningResult,
} from './app-provisioning.service.js';

// Run Lifecycle service
export { runLifecycleService } from './run-lifecycle.service.js';

// Synthesis service
export { synthesisService, REQUIRED_SECTIONS } from './synthesis.service.js';
export type { SynthesisInput, SynthesisResult } from './synthesis.service.js';

// Progress Emitter service
export { progressEmitterService } from './progress-emitter.service.js';
export type { ProgressEmitter } from './progress-emitter.service.js';
