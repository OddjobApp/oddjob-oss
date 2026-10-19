import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { approvalRequests, missionBlackboardHistory, missionRuns } from "@shared/schema/index.js";
import { classifyMissionEvidence, type MissionEvidenceLevel } from "./mission-audit-integrity.js";

export interface ReliabilityRunInput {
  id: number;
  status: string;
  isSuccess: boolean | null;
  isShadow: boolean;
  missionContext: unknown;
  name: string;
  costUsd: string | number | null;
  createdAt: Date;
  updatedAt: Date;
  approvalCount: number;
  recoveryAttempted: boolean;
}

export interface ReliabilityCohortMetrics {
  sampleSize: number;
  terminalRuns: number;
  completedRuns: number;
  failedRuns: number;
  outcomeMeasuredRuns: number;
  successfulOutcomes: number;
  humanInterventionRuns: number;
  autonomousCompletedRuns: number;
  recoveryAttemptedRuns: number;
  recoverySucceededRuns: number;
  technicalCompletionRate: number | null;
  outcomeSuccessRate: number | null;
  autonomousSuccessRate: number | null;
  humanInterventionRate: number | null;
  recoverySuccessRate: number | null;
  averageDurationMs: number | null;
  averageCostPerCompletedRunUsd: number | null;
}

export interface MissionReliabilityEvidence {
  schemaVersion: "oddjob.mission-reliability-evidence.v1";
  generatedAt: string;
  windowDays: number;
  organizationId: number;
  productionClaimsAllowed: boolean;
  productionSampleSize: number;
  warnings: string[];
  cohorts: Record<MissionEvidenceLevel, ReliabilityCohortMetrics>;
}

const levels: MissionEvidenceLevel[] = [
  "contract",
  "integration",
  "staging",
  "production",
  "customer_verified",
];

export function calculateReliabilityEvidence(
  inputs: ReliabilityRunInput[],
  organizationId: number,
  windowDays: number,
): MissionReliabilityEvidence {
  const grouped: Record<MissionEvidenceLevel, ReliabilityRunInput[]> = {
    contract: [],
    integration: [],
    staging: [],
    production: [],
    customer_verified: [],
  };

  for (const input of inputs) {
    const provenance = classifyMissionEvidence(input as unknown as Record<string, unknown>);
    grouped[provenance.level].push(input);
  }

  const cohorts = Object.fromEntries(
    levels.map((level) => [level, summarizeCohort(grouped[level])]),
  ) as Record<MissionEvidenceLevel, ReliabilityCohortMetrics>;
  const productionSampleSize = cohorts.production.sampleSize + cohorts.customer_verified.sampleSize;
  const warnings = [
    productionSampleSize === 0 ? "No production evidence exists in this reporting window." : undefined,
    productionSampleSize > 0 && productionSampleSize < 30
      ? "Production sample size is below 30 runs; percentages are directional, not statistically stable."
      : undefined,
    cohorts.customer_verified.sampleSize === 0
      ? "No outcomes in this window are explicitly customer verified."
      : undefined,
  ].filter((warning): warning is string => Boolean(warning));

  return {
    schemaVersion: "oddjob.mission-reliability-evidence.v1",
    generatedAt: new Date().toISOString(),
    windowDays,
    organizationId,
    productionClaimsAllowed: productionSampleSize > 0,
    productionSampleSize,
    warnings,
    cohorts,
  };
}

export async function getOrganizationReliabilityEvidence(
  organizationId: number,
  windowDays = 30,
): Promise<MissionReliabilityEvidence> {
  const boundedWindow = Math.min(Math.max(Math.trunc(windowDays), 1), 365);
  const cutoff = new Date(Date.now() - boundedWindow * 24 * 60 * 60 * 1000);
  const runs = await db
    .select({
      id: missionRuns.id,
      status: missionRuns.status,
      isSuccess: missionRuns.isSuccess,
      isShadow: missionRuns.isShadow,
      missionContext: missionRuns.missionContext,
      name: missionRuns.name,
      costUsd: missionRuns.costUsd,
      createdAt: missionRuns.createdAt,
      updatedAt: missionRuns.updatedAt,
    })
    .from(missionRuns)
    .where(and(
      eq(missionRuns.organizationId, organizationId),
      gte(missionRuns.createdAt, cutoff),
      isNull(missionRuns.deletedAt),
    ));

  if (runs.length === 0) {
    return calculateReliabilityEvidence([], organizationId, boundedWindow);
  }

  const runIds = runs.map((run) => run.id);
  const runIdStrings = runIds.map(String);
  const [approvals, checkpoints] = await Promise.all([
    db.select({ executionId: approvalRequests.executionId })
      .from(approvalRequests)
      .where(and(
        eq(approvalRequests.organizationId, organizationId),
        inArray(approvalRequests.executionId, runIdStrings),
      )),
    db.select({
      missionRunId: missionBlackboardHistory.missionRunId,
      changeReason: missionBlackboardHistory.changeReason,
    })
      .from(missionBlackboardHistory)
      .where(inArray(missionBlackboardHistory.missionRunId, runIds)),
  ]);

  const approvalCounts = new Map<number, number>();
  for (const approval of approvals) {
    const runId = Number(approval.executionId);
    if (!Number.isInteger(runId)) continue;
    approvalCounts.set(runId, (approvalCounts.get(runId) ?? 0) + 1);
  }
  const recoveryRuns = new Set(
    checkpoints
      .filter((checkpoint) => checkpoint.changeReason?.startsWith("recovery_applied:"))
      .map((checkpoint) => checkpoint.missionRunId)
      .filter((id): id is number => id != null),
  );

  return calculateReliabilityEvidence(runs.map((run) => ({
    ...run,
    approvalCount: approvalCounts.get(run.id) ?? 0,
    recoveryAttempted: recoveryRuns.has(run.id),
  })), organizationId, boundedWindow);
}

function summarizeCohort(runs: ReliabilityRunInput[]): ReliabilityCohortMetrics {
  const terminal = runs.filter((run) => run.status === "completed" || run.status === "failed");
  const completed = terminal.filter((run) => run.status === "completed");
  const failed = terminal.filter((run) => run.status === "failed");
  const outcomeMeasured = terminal.filter((run) => run.isSuccess != null);
  const successfulOutcomes = outcomeMeasured.filter((run) => run.isSuccess === true);
  const intervened = runs.filter((run) => run.approvalCount > 0);
  const autonomousCompleted = completed.filter((run) => run.approvalCount === 0);
  const recoveryAttempted = runs.filter((run) => run.recoveryAttempted);
  const recoverySucceeded = recoveryAttempted.filter((run) => run.status === "completed");
  const completedCosts = completed.map((run) => numeric(run.costUsd));

  return {
    sampleSize: runs.length,
    terminalRuns: terminal.length,
    completedRuns: completed.length,
    failedRuns: failed.length,
    outcomeMeasuredRuns: outcomeMeasured.length,
    successfulOutcomes: successfulOutcomes.length,
    humanInterventionRuns: intervened.length,
    autonomousCompletedRuns: autonomousCompleted.length,
    recoveryAttemptedRuns: recoveryAttempted.length,
    recoverySucceededRuns: recoverySucceeded.length,
    technicalCompletionRate: ratio(completed.length, terminal.length),
    outcomeSuccessRate: ratio(successfulOutcomes.length, outcomeMeasured.length),
    autonomousSuccessRate: ratio(autonomousCompleted.length, completed.length),
    humanInterventionRate: ratio(intervened.length, runs.length),
    recoverySuccessRate: ratio(recoverySucceeded.length, recoveryAttempted.length),
    averageDurationMs: average(terminal.map((run) => Math.max(0, run.updatedAt.getTime() - run.createdAt.getTime()))),
    averageCostPerCompletedRunUsd: average(completedCosts),
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 10_000;
}

function average(values: number[]): number | null {
  return values.length === 0
    ? null
    : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function numeric(value: string | number | null): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
