/**
 * SDLC Code Generation Pipeline — Domain Types
 *
 * Core interfaces for the generation session lifecycle, artifact registry,
 * contract validation, cost rollup, and pipeline orchestration.
 *
 * These are service-level types (richer than raw DB rows). Schema types
 * live in `shared/schema/generation-sessions.ts` and `shared/schema/artifact-registry.ts`.
 */

import type { JSONSchema7 } from "json-schema";

// ─── Session Lifecycle ──────────────────────────────────────────────────────

export type SessionStatus =
  | "pending"
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "blocked";

export interface CreateSessionParams {
  templateId: string;
  orgId: number;
  userId: string;
  assignedTeamId?: number;
  inputParams: Record<string, unknown>;
  budgetLimitUsd?: number;
  ttlHours?: number;
  autonomousConfig?: AutonomousCodegenConfig;
}

export interface GenerationSession {
  id: string;
  templateId: string;
  cycleId: number;
  assignedTeamId?: number | null;
  orgId: number;
  status: SessionStatus;
  currentPhase: string | null;
  phases: PhaseStatus[];
  totalCostUsd: number;
  startedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface PhaseStatus {
  phase: string;
  status: "pending" | "active" | "completed" | "failed" | "skipped";
  startedAt: Date | null;
  completedAt: Date | null;
  artifactCount: number;
  costUsd: number;
}

export interface SessionMetrics {
  sessionId: string;
  totalCostUsd: number;
  totalTokens: number;
  totalDurationMs: number;
  phases: PhaseMetrics[];
}

interface PhaseMetrics {
  phase: string;
  durationMs: number;
  costUsd: number;
  tokenCount: number;
  missionRunCount: number;
}

export interface BudgetStatus {
  sessionId: string;
  budgetLimitUsd: number | null;
  currentCostUsd: number;
  percentUsed: number;
  exceeded: boolean;
}

export interface SessionFilters {
  status?: SessionStatus;
  templateId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

// ─── Artifact Contracts & Validation ────────────────────────────────────────

export interface ArtifactContract {
  schemaVersion: string;
  jsonSchema: JSONSchema7;
  requiredFields: string[];
  mimeType?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params?: Record<string, unknown>;
}

export interface CompatibilityResult {
  compatible: boolean;
  missingFields: string[];
  details: string[];
}

// ─── Artifact Registry ──────────────────────────────────────────────────────

export interface PersistArtifactParams {
  sessionId: string;
  phase: string;
  name: string;
  content: unknown;
  mimeType: string;
  missionRunId: number;
}

export interface ArtifactRecord {
  id: number;
  sessionId: string;
  phase: string;
  name: string;
  version: number;
  content: unknown;
  mimeType: string;
  missionRunId: number;
  validatedAt: Date;
  createdAt: Date;
}

export interface ArtifactLineage {
  sessionId: string;
  phases: ArtifactLineagePhase[];
  totalArtifacts: number;
}

interface ArtifactLineagePhase {
  phase: string;
  artifacts: ArtifactRecord[];
}

// ─── Session Events ─────────────────────────────────────────────────────────

export type SessionEvent =
  | { type: "phase_started"; phase: string }
  | { type: "phase_completed"; phase: string }
  | { type: "phase_failed"; phase: string; error: string }
  | { type: "budget_exceeded" }
  | { type: "ttl_expired" }
  | { type: "cancelled"; reason: string };

export interface PipelineLifecycleEvent {
  eventType:
    | "session_created"
    | "phase_started"
    | "phase_completed"
    | "phase_failed"
    | "session_completed"
    | "budget_alert"
    | "fix_attempt_started"
    | "fix_attempt_completed"
    | "test_loop_exhausted"
    | "quality_gate_blocked"
    | "quality_gate_passed"
    | "incremental_verification_failed"
    | "human_review_requested"
    | "pr_created";
  sessionId: string;
  orgId: number;
  timestamp: Date;
  payload: Record<string, unknown>;
}

// ─── Cost Rollup ────────────────────────────────────────────────────────────

export interface CostBreakdown {
  totalUsd: number;
  byPhase: Record<string, number>;
  byProvider: Record<string, number>;
  tokenCount: number;
}

// ─── Autonomous Codegen Pipeline Types ──────────────────────────────────────

// --- Verification Level & Configuration ---

export type VerificationLevel = "none" | "lint_only" | "type_check" | "full_test";

export interface AutonomousCodegenConfig {
  verificationLevel: VerificationLevel;
  maxFixAttempts: number;           // default: 5
  maxFileCount: number;             // default: 50
  contextTokenBudget: number;       // default: 100_000
  dependencyTraceDepth: number;     // default: 3
  repository: {
    url?: string;                   // remote repository URL
    workspacePath?: string;         // local workspace path
    branch?: string;                // target branch (default: main)
    credentials?: string;           // credential reference ID
  };
  prTemplate?: string;              // detected or specified PR template
  branchNamingPattern?: string;     // e.g., "codegen/{session-id}/{objective-slug}"
}

// --- Session Metadata Extension ---

export interface SessionMetadataExtension {
  pipeline_mode: "code_generation";
  autonomous_config: AutonomousCodegenConfig;
  metrics: {
    fixAttempts: number;
    successfulFixes: number;
    failedFixes: number;
    totalVerificationTime: number;
    testLoopIterations: number;
    currentAttemptNumber?: number;
    currentAttemptElapsedMs?: number;
  };
}

// --- Verification Report & Events ---

export interface VerificationReport {
  sessionId: string;
  verificationLevel: VerificationLevel;
  timeline: VerificationEvent[];
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    fixAttempts: number;
    successfulFixes: number;
    totalDuration: number;
  };
  finalStatus: "all_passed" | "has_failures" | "in_progress";
  // v2 Extension 3 — Mock Link Sandboxing (optional).
  sandboxing?: Sandboxing;
}

export interface VerificationEvent {
  timestamp: Date;
  type:
    | "step_check"
    | "test_loop_iteration"
    | "fix_attempt"
    | "quality_gate"
    // v2: sandbox stubbing + mutation-test activity entries.
    | "sandbox_stub"
    | "mutation_test";
  operationId?: string;
  status: "passed" | "failed" | "skipped";
  details: Record<string, unknown>;
  duration: number;
}

// --- v2 Extension 3: Mock Link Sandboxing ---

export type ExternalRegistry =
  | "salesforce"
  | "slack"
  | "twilio"
  | "stripe"
  | "github"
  | "http_generic"
  | "other";

export type StubStrategy = "msw" | "sandbox_schema" | "in_memory_fake" | "none";

export interface Sandboxing {
  enabled: boolean;
  detectedIntegrations: DetectedIntegration[];
  stubbedCallCount: number;
  mswHandlersGenerated?: string[];  // identifiers/paths of generated MSW handlers
  sandboxSchemaRef?: string;
  networkIsolationApplied: boolean;
  unstubbedExternalCalls?: UnstubbedExternalCall[];
}

export interface DetectedIntegration {
  registry: ExternalRegistry;
  callSites: IntegrationCallSite[];
  stubStrategy: StubStrategy;
}

export interface IntegrationCallSite {
  filePath: string;
  symbol: string;
  line?: number;
}

export interface UnstubbedExternalCall {
  filePath: string;
  symbol: string;
  reason: string;
}

// --- Repository Context Loader ---

export interface RepositoryContext {
  projectStructure: FileTreeNode[];
  dependencyGraph: DependencyGraph;
  conventions: DetectedConventions;
  languageMetadata: LanguageMetadata;
  relevantFiles: RelevantFile[];
  tokenCount: number;
  // v2 Extension 2 — Predictive Blast-Radius Scoping (optional).
  blastRadius?: BlastRadius;
}

export interface FileTreeNode {
  path: string;
  type: "file" | "directory";
  language?: string;
  size?: number;
  children?: FileTreeNode[];
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

export interface DependencyNode {
  filePath: string;
  exports: string[];
  language: string;
}

export interface DependencyEdge {
  source: string;   // importing file
  target: string;   // imported file
  importType: "static" | "dynamic" | "type_only";
}

export interface DetectedConventions {
  namingPatterns: NamingPattern[];
  formattingRules: FormattingRule[];
  architecturalPatterns: string[];
  testingConventions: TestConvention[];
  prTemplate?: string;
  branchNaming?: string;
}

export interface NamingPattern {
  scope: string;
  pattern: string;
  examples: string[];
}

export interface FormattingRule {
  rule: string;
  value: string | number | boolean;
}

export interface TestConvention {
  framework: string;
  filePattern: string;
  location: string;
}

export interface LanguageMetadata {
  primaryLanguage: string;
  frameworks: string[];
  packageManager?: string;
  buildTool?: string;
  testRunner?: string;
}

export interface RelevantFile {
  path: string;
  content: string;
  relevanceScore: number;   // 0-1, from objective-based filtering
  // v2: why this file entered context. `blast_radius` marks a file auto-hoisted
  // as an upstream dependant of a targeted file (see BlastRadius).
  inclusionReason?: "objective_match" | "blast_radius" | "convention_anchor";
}

// --- v2 Extension 2: Predictive Blast-Radius Scoping ---

export interface BlastRadius {
  traceDepth: number;
  scopedFiles: BlastRadiusScopedFile[];
  totalDependantsPulled: number;
  regressionRiskScore: number;      // aggregate 0-1 across scoped files
}

export interface BlastRadiusScopedFile {
  targetFile: string;
  operationHint: "create" | "modify" | "delete" | "read";
  upstreamDependants: BlastRadiusDependant[];
  autoIncludedInContext: boolean;   // true when hoisted into relevantFiles
}

export interface BlastRadiusDependant {
  filePath: string;
  importType: "static" | "dynamic" | "type_only";
  distance: number;                 // hops from the target file (>= 1)
  regressionRisk: "low" | "medium" | "high";
}

// --- Change Planner ---

export interface EditPlan {
  sessionId: string;
  objective: string;
  operations: FileOperation[];
  dependencyOrder: string[];        // topological sort of operation IDs
  totalFileCount: number;
  requiresHumanReview: boolean;     // flipped by the Refiner Agent for security-critical targets
  // v2 Extension 1 — Agentic Consensus Matrix (optional).
  consensusMatrix?: ConsensusMatrix;
  // v2 Extension 5 — Adaptive Resource Scaling decision (optional).
  adaptiveScaling?: AdaptiveScaling;
}

export interface FileOperation {
  id: string;
  type: "create" | "modify" | "delete";
  filePath: string;
  dependsOn: string[];              // operation IDs that must complete first
  rationale: string;
  changes?: CodeChange[];           // for 'modify' operations
  newContent?: string;              // for 'create' operations
}

export interface CodeChange {
  startLine: number;
  endLine: number;
  originalCode: string;
  newCode: string;
  contextLines: number;
}

// --- v2 Extension 1: Agentic Consensus Matrix ---

export type ConsensusAgentRole = "architect" | "security_performance" | "refiner";
export type ConsensusSeverity = "low" | "medium" | "high" | "critical";

export interface ConsensusMatrix {
  iterations: number;
  architectDraftId?: string;
  agents: ConsensusAgent[];
  securityAudit?: SecurityAudit;
  refinerDecision: RefinerDecision;
  consensusScore: number;           // cross-agent agreement, 0-1
  dissentCount?: number;
}

export interface ConsensusAgent {
  role: ConsensusAgentRole;
  model?: string;
  confidence: number;               // self-reported, 0-1
  findings: string[];
  durationMs?: number;
}

export interface SecurityAudit {
  tokenLeakFindings: TokenLeakFinding[];
  vulnerabilityPatterns: VulnerabilityPatternFinding[];
  dependencyRisks: DependencyRiskFinding[];
}

export interface TokenLeakFinding {
  location: string;
  severity: ConsensusSeverity;
  description: string;
}

export interface VulnerabilityPatternFinding {
  pattern: string;
  cwe?: string;
  filePath: string;
  severity: ConsensusSeverity;
}

export interface DependencyRiskFinding {
  dependency: string;
  reason: string;
  severity: ConsensusSeverity;
}

export interface RefinerDecision {
  finalizedBy?: string;
  humanReviewTriggered: boolean;    // mirrors EditPlan.requiresHumanReview
  triggerReasons: string[];
  securityCriticalStructuresTargeted?: string[];
}

// --- v2 Extension 5: Telemetry-Driven Adaptive Resource Scaling ---

export type ModelTier = "premium" | "standard" | "economy";

export interface AdaptiveScaling {
  triggered: boolean;
  trigger: "none" | "multi_file_refactor" | "large_context" | "high_dependency_fanout";
  detectedFileCount?: number;
  original: AdaptiveScalingBudget;
  scaled: AdaptiveScalingBudget;
  modelTierRouting?: ModelTierRoute[];
  downshiftedPhases?: string[];     // phases downshifted to cheaper models to fund the scale-up
  estimatedCostDeltaUsd?: number;
}

export interface AdaptiveScalingBudget {
  contextTokenBudget: number;
  maxFileCount: number;
}

export interface ModelTierRoute {
  phase: string;
  task?: string;
  model: string;
  tier: ModelTier;
}

// --- Change Impact Analyzer ---

export interface ImpactAnalysis {
  affectedTestFiles: string[];
  affectedSourceFiles: string[];
  traceDepth: number;
  confidence: "high" | "medium" | "low";
  fullSuiteFallback: boolean;
}

// --- Incremental Verifier ---

export interface StepVerificationResult {
  operationId: string;
  filePath: string;
  status: "passed" | "failed" | "skipped";
  checks: VerificationCheck[];
  duration: number;
  timestamp: Date;
}

export interface VerificationCheck {
  type: "lint" | "type_check" | "unit_test";
  passed: boolean;
  errors?: VerificationDiagnostic[];
  duration: number;
}

export interface VerificationDiagnostic {
  file: string;
  line?: number;
  message: string;
  severity: "error" | "warning";
  rule?: string;
}

// --- Test Loop Controller ---

export interface TestLoopResult {
  status:
    | "all_passed"
    | "partially_fixed"
    | "exhausted"
    | "escalated"
    // v2: surviving mutations exposed a weak assertion suite.
    | "weak_assertion";
  totalAttempts: number;
  fixAttempts: FixAttemptRecord[];
  passingTests: string[];
  failingTests: string[];
  duration: number;
  // v2 Extension 4 — Automated Mutation Testing (optional; full_test tier).
  mutationTesting?: MutationTesting;
}

export interface FixAttemptRecord {
  attemptNumber: number;
  timestamp: Date;
  diagnosis: FailureDiagnosis;
  appliedFix: AppliedFix;
  outcome: "resolved" | "failed" | "regression_detected" | "reverted";
  duration: number;
  newFailuresIntroduced: string[];
}

export interface FailureDiagnosis {
  testFile: string;
  testName: string;
  errorMessage: string;
  stackTrace?: string;
  rootCause: string;
  affectedFile: string;
  suggestedApproach: string;
}

export interface AppliedFix {
  filePath: string;
  changes: CodeChange[];
  description: string;
}

// --- v2 Extension 4: Automated Mutation Testing ---

export type MutationType =
  | "conditional_boundary"
  | "negate_conditional"
  | "arithmetic_operator"
  | "return_value"
  | "remove_call"
  | "string_literal"
  | "increment";

export interface MutationTesting {
  enabled: boolean;
  tier?: "full_test";               // mutation testing only runs at full_test
  mutationsInjected: InjectedMutation[];
  injectedCount: number;
  survivedCount: number;
  killedCount: number;
  mutationScore: number;            // killed / injected, 0-1
  weakAssertionDetected: boolean;
  forcedRefactorIteration: boolean;
  refactorIterationsTriggered?: number;
}

export interface InjectedMutation {
  id: string;
  filePath: string;
  mutationType: MutationType;
  location: MutationLocation;
  survived: boolean;                // true = no test caught it (a weak spot)
  killingTest?: string;
}

export interface MutationLocation {
  startLine: number;
  endLine: number;
}

// --- Quality Gate ---

export interface QualityGateResult {
  passed: boolean;
  evaluatedAt: Date;
  checks: QualityCheck[];
  blockingFailures: QualityFailure[];
}

export interface QualityCheck {
  name: string;
  description: string;
  passed: boolean;
  details?: string;
  // v2: which extension a gate check originated from, when applicable.
  source?:
    | "baseline"
    | "consensus_matrix"
    | "blast_radius"
    | "sandboxing"
    | "mutation_testing"
    | "adaptive_scaling";
}

export interface QualityFailure {
  check: string;
  reason: string;
  operationId?: string;
  testFile?: string;
}

// --- PR Generator ---

export interface PRResult {
  branchName: string;
  commitSha: string;
  prUrl: string;
  prNumber: number;
  description: string;
  testEvidence: TestEvidence;
}

export interface TestEvidence {
  totalTests: number;
  passingTests: number;
  fixAttempts: number;
  verificationTimeline: string;   // markdown summary
  // v2: assertion-strength + isolation evidence surfaced in the PR body.
  mutationScore?: number;         // 0-1, from MutationTesting
  sandboxed?: boolean;            // external integrations were stubbed during verification
}
