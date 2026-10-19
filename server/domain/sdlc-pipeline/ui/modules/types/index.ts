/**
 * Codegen Pipeline Workbench — Frontend Types
 *
 * View-model interfaces consumed by the workbench UI (pages, hooks, components),
 * plus re-exports of the service-level domain types from `core/types.ts`.
 *
 * NOTE on timestamps: these view-models are populated from JSON API responses,
 * where `Date` fields are serialized to ISO strings. View-model interfaces below
 * therefore type timestamps as `string`. The re-exported core types keep `Date`
 * (they describe the server-side shapes); hooks parse/format as needed.
 */

import type {
  SessionStatus,
  PhaseStatus,
  StepVerificationResult,
  AppliedFix,
  FixAttemptRecord,
  PipelineLifecycleEvent,
  AutonomousCodegenConfig,
} from "../../../core/types.js";

// Re-export the full service-level type surface for the workbench.
export type * from "../../../core/types.js";

// ─── Session List (dashboard table row) ─────────────────────────────────────

export interface SessionListItem {
  id: string;
  templateId: string;
  status: SessionStatus;
  currentPhase: string | null;
  phases: PhaseStatus[];
  totalCostUsd: number;
  startedAt: string;            // ISO
  completedAt: string | null;   // ISO
  metadata?: Record<string, unknown>;
  /** Derived from a blocked quality gate for the status-badge tooltip. */
  blockedReason?: string;
}

// ─── Decision Gates ─────────────────────────────────────────────────────────

export type DecisionGateType =
  | "scope_approval"
  | "artifact_contract"
  | "quality_gate"
  | "budget"
  | "ttl";

export type DecisionGateStatus =
  | "pending"
  | "passed"
  | "failed"
  | "overridden"
  | "skipped";

export interface DecisionGateEntry {
  id: string;
  type: DecisionGateType;
  label: string;
  status: DecisionGateStatus;
  evaluatedAt: string | null;   // ISO
  /** Gate-specific detail: file count vs threshold, cost vs budget, validation errors, etc. */
  details?: Record<string, unknown>;
  blockingFailures?: string[];
  override?: { userId: string; timestamp: string; reason?: string };
  /** Pending gate that needs a human decision (drives the attention indicator). */
  requiresAttention?: boolean;
}

// ─── Tasks (Tasks tab) ──────────────────────────────────────────────────────

export type TaskEntryStatus = "pending" | "in_progress" | "completed" | "failed";

export interface TaskEntry {
  id: string;
  title: string;
  status: TaskEntryStatus;
  order: number;
  rationale?: string;
  affectedFiles: string[];
  verificationResults?: StepVerificationResult[];
}

// ─── Tests (Tests tab) ──────────────────────────────────────────────────────

export type TestOutcome = "passed" | "failed" | "fixed" | "skipped";
export type TestCategory = "pre_existing" | "generated" | "regression";

export interface TestResult {
  name: string;
  filePath: string;
  outcome: TestOutcome;
  category: TestCategory;
  durationMs: number;
  /** Number of fix iterations applied before this test passed (if any). */
  fixIterations?: number;
  /** True when the fix loop was exhausted without resolving this test. */
  exhausted?: boolean;
  assertionOutput?: string;
  stackTrace?: string;
  rootCause?: string;
  appliedFix?: AppliedFix;
  fixHistory?: FixAttemptRecord[];
}

// ─── Aggregate Analytics (quality metrics page) ─────────────────────────────
//
// Mirrors the `GET /api/generation-sessions/analytics` response shape exactly.

export interface AggregateAnalytics {
  totalSessions: number;
  activeCount: number;
  blockedCount: number;
  completedCount: number;
  failedCount: number;
  fixAttempts: {
    total: number;
    resolved: number;
    failed: number;
    reverted: number;
  };
  averageTimeToFixMs: number;
  qualityGatePassRate: number;   // 0-1
  totalCost: number;
  costByPhase: Record<string, number>;
  /** 6-bucket histogram of test-loop iterations (index 5 = "5+"). */
  testLoopDistribution: number[];
  verificationPassRateOverTime: Array<{ date: string; rate: number }>;
  costOverTime: Array<{ date: string; cost: number; sessionCount: number }>;
}

// ─── Session Creation ───────────────────────────────────────────────────────
//
// Mirrors the `POST /api/generation-sessions` request body.

export interface CreateSessionInput {
  templateId: string;
  inputParams: Record<string, unknown>;
  budgetLimitUsd?: number;
  ttlHours?: number;
  autonomousConfig?: AutonomousCodegenConfig;
}

// ─── Event Stream ───────────────────────────────────────────────────────────
//
// Mirrors the `GET /api/generation-sessions/:id/events` response shape.

export interface EventStreamResponse {
  events: PipelineLifecycleEvent[];
  cursor: string;
}

// ─── Autonomous Metrics ─────────────────────────────────────────────────────
//
// The `metrics` block from `SessionMetadataExtension`, surfaced for the
// CostMetricsPanel and Overview tab.

export interface AutonomousMetrics {
  fixAttempts: number;
  successfulFixes: number;
  failedFixes: number;
  totalVerificationTime: number;
  testLoopIterations: number;
  currentAttemptNumber?: number;
  currentAttemptElapsedMs?: number;
}
