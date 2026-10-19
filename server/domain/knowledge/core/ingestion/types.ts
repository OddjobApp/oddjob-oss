/**
 * Ingestion Orchestrator - Types and Interfaces
 *
 * Core type definitions for the autonomous research ingestion system.
 * Covers input classification, gathering strategy, collector invocations,
 * orchestration results, and run status tracking.
 */

// ─── Input Types ───────────────────────────────────────────────────────────────

/** Raw research subject provided by the user */
export interface ResearchSubjectInput {
  /** The raw text (topic keyword/phrase or URL) */
  value: string;
  /** Maximum number of sources to collect. Default: 20 */
  maxSources?: number;
  /** Maximum token budget for the research cycle. Default: 500000 */
  tokenBudget?: number;
  /** Subset of collector types to enable for this run */
  enabledCollectors?: SourceCollectorType[];
}

/** Result of classifying and normalizing user input */
export interface ClassifiedInput {
  /** Whether the input is a topic keyword or a URL */
  type: "topic" | "url";
  /** Original input value */
  value: string;
  /** Normalized form: trimmed/lowercased for topics; validated URL for urls */
  normalizedValue: string;
}

// ─── Source Collectors ─────────────────────────────────────────────────────────

/** Supported source collector module types */
export type SourceCollectorType =
  | "web_scraper"
  | "academic_search"
  | "api_documentation_parser"
  | "code_repository_scanner"
  | "document_parser";

/** A single collector invocation within a gathering strategy */
export interface CollectorInvocation {
  /** UUID for tracking this invocation */
  id: string;
  /** Which collector module to use */
  collectorType: SourceCollectorType;
  /** Search query or URL to fetch */
  query: string;
  /** Execution order priority (lower = earlier) */
  priority: number;
  /** Estimated relevance score (0.0 - 1.0) */
  estimatedYield: number;
  /** Timeout in milliseconds. Default: 60000 */
  timeout: number;
  /** Collector-specific configuration */
  metadata?: Record<string, unknown>;
}

// ─── Gathering Strategy ────────────────────────────────────────────────────────

/** A plan specifying which sources to query and in what order */
export interface GatheringStrategy {
  /** UUID identifying this strategy */
  id: string;
  /** The classified research subject this strategy targets */
  researchSubject: ClassifiedInput;
  /** Ordered list of collector invocations to execute */
  collectors: CollectorInvocation[];
  /** Maximum source count for this strategy */
  maxSources: number;
  /** Token budget for the research cycle */
  tokenBudget: number;
  /** Count of existing Knowledge Graph entities related to the subject */
  existingEntityCount: number;
  /** ISO 8601 timestamp of strategy creation */
  createdAt: string;
}

// ─── Orchestration Lifecycle ───────────────────────────────────────────────────

/** Pipeline execution stage progression */
export type IngestionStage =
  | "planning"
  | "collecting"
  | "extracting"
  | "synthesizing"
  | "completed"
  | "failed";

/** Result returned when an orchestration run is initiated or checked */
export interface IngestionOrchestrationResult {
  /** The pipeline execution record ID */
  pipelineExecutionId: number;
  /** The strategy UUID used for this run */
  strategyId: string;
  /** Current stage of the orchestration */
  status: IngestionStage;
}

// ─── Run Status & History ──────────────────────────────────────────────────────

/** Full detail status of an orchestration run */
export interface IngestionRunStatus {
  /** Pipeline execution ID */
  pipelineExecutionId: number;
  /** Current pipeline stage */
  stage: IngestionStage;
  /** The research subject that initiated this run */
  researchSubject: ClassifiedInput;
  /** The gathering strategy used */
  strategy: GatheringStrategy;
  /** Aggregated metrics for the run */
  metrics: IngestionRunMetrics;
  /** ISO 8601 timestamp when the run started */
  startedAt: string;
  /** ISO 8601 timestamp when the run completed (null if still running) */
  completedAt: string | null;
  /** Error message if the run failed */
  error?: string;
}

/** Metrics collected during an orchestration run */
export interface IngestionRunMetrics {
  sourcesCollected: number;
  sourcesFailed: number;
  entitiesCreated: number;
  relationshipsCreated: number;
  datasetItemsStored: number;
  datasetId: number | null;
  documentTemplateId: number | null;
  tokenBudgetUsed: number;
  durationMs: number;
}

/** Summary item for listing past orchestration runs */
export interface IngestionRunSummary {
  /** Pipeline execution ID */
  pipelineExecutionId: number;
  /** The original research subject value */
  subject: string;
  /** Input classification type */
  subjectType: "topic" | "url";
  /** Final status of the run */
  status: IngestionStage;
  /** ISO 8601 timestamp of the run */
  date: string;
  /** High-level output metrics */
  metrics: {
    sourcesCollected: number;
    entitiesCreated: number;
    datasetItemsStored: number;
  };
}
