import { db } from "@server/database_service.js";
import {
  approvalRequests,
  eventLog,
  missionBlackboardHistory,
  missionRuns,
  pipelineExecutions,
  pipelineStepExecutions,
} from "@shared/schema/index.js";
import { trycuaComputerUseTaskSteps } from "@shared/schema/integrations/trycua.js";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { NotFoundError } from "@server/utils/errors.js";

export type MissionEvidenceEventKind =
  | "run"
  | "action"
  | "trace"
  | "checkpoint"
  | "approval"
  | "event"
  | "pipeline"
  | "computer_use";

export type MissionEvidenceDirection = "asc" | "desc";

export interface MissionEvidenceEvent {
  id: string;
  missionRunId: number;
  missionId?: number | null;
  kind: MissionEvidenceEventKind;
  source: "mission_run" | "dynamic_trace" | "blackboard_history" | "approval_request" | "event_log" | "pipeline_execution" | "trycua_step" | "ontology_action_log";
  event: string;
  title: string;
  timestamp: string;
  sequence: number;
  status?: string | null;
  actor?: string | null;
  summary?: string;
  cycle?: number | null;
  traceCycleId?: string | null;
  action?: string | null;
  toolName?: string | null;
  payload?: unknown;
  /** State diff produced by action-runtime-kernel, present on action events. */
  snapshotDiff?: {
    blackboard?: Record<string, { added?: string[]; removed?: string[]; changed?: string[] }>;
    missionContext?: Record<string, { added?: string[]; removed?: string[]; changed?: string[] }>;
  };
  evidence: {
    table?: string;
    rowId?: number | string | null;
    traceIndex?: number;
    eventId?: string;
    actionId?: string;
  };
}

export interface MissionEvidenceTimeline {
  missionRunId: number;
  missionId: number | null;
  generatedAt: string;
  direction: MissionEvidenceDirection;
  limit: number;
  events: MissionEvidenceEvent[];
}

interface TimelineBuildInput {
  run: Record<string, unknown>;
  dynamicTrace?: unknown[];
  checkpoints?: Array<Record<string, unknown>>;
  approvals?: Array<Record<string, unknown>>;
  eventLogEntries?: Array<Record<string, unknown>>;
  trycuaSteps?: Array<Record<string, unknown>>;
}

interface TimelineBuildOptions {
  includePayloads?: boolean;
  direction?: MissionEvidenceDirection;
  limit?: number;
  /** Filter to only these event kinds. Omit to include all. */
  kinds?: MissionEvidenceEventKind[];
  /** ISO timestamp — only include events at or after this time. */
  from?: string;
  /** ISO timestamp — only include events at or before this time. */
  to?: string;
}

export function buildMissionEvidenceTimeline(input: TimelineBuildInput, options: TimelineBuildOptions = {}): MissionEvidenceEvent[] {
  const missionRunId = Number(input.run.id);
  const missionId = numberOrNull(input.run.missionId);
  const includePayloads = options.includePayloads === true;

  const all: MissionEvidenceEvent[] = [
    ...normalizeRunEvents(input.run, missionRunId, missionId, includePayloads),
    ...(input.dynamicTrace ?? []).map((entry, index) =>
      normalizeDynamicTraceEntry(entry, index, missionRunId, missionId, { includePayloads })
    ),
    ...(input.checkpoints ?? []).map((row, index) =>
      normalizeCheckpoint(row, index, missionRunId, missionId, { includePayloads })
    ),
    ...(input.approvals ?? []).map((row) =>
      normalizeApproval(row, missionRunId, missionId, { includePayloads })
    ),
    ...(input.eventLogEntries ?? []).map((row) =>
      normalizeEventLog(row, missionRunId, missionId, { includePayloads })
    ),
    ...(input.trycuaSteps ?? []).map((row, index) =>
      normalizeTrycuaStep(row, index, missionRunId, missionId, { includePayloads })
    ),
  ];

  let events = all;

  // Apply kind filter
  if (options.kinds && options.kinds.length > 0) {
    const kindSet = new Set(options.kinds);
    events = events.filter(e => kindSet.has(e.kind));
  }

  // Apply date range filter
  if (options.from) {
    const fromMs = new Date(options.from).getTime();
    events = events.filter(e => new Date(e.timestamp).getTime() >= fromMs);
  }
  if (options.to) {
    const toMs = new Date(options.to).getTime();
    events = events.filter(e => new Date(e.timestamp).getTime() <= toMs);
  }

  return sortEvidenceEvents(events, options.direction ?? "desc").slice(0, clampLimit(options.limit));
}

export function normalizeDynamicTraceEntry(
  entry: unknown,
  index: number,
  missionRunId: number,
  missionId?: number | null,
  options: { includePayloads?: boolean } = {},
): MissionEvidenceEvent {
  const record = asRecord(entry);
  const rawEvent = stringOr(record.event, stringOr(record.type, "trace"));
  const kind = record.type === "action_execution" || rawEvent.startsWith("action_") || typeof record.actionId === "string"
    ? "action"
    : "trace";
  const status = stringOrNull(record.status) ?? statusFromTrace(record);
  const action = stringOrNull(record.action);
  const toolName = stringOrNull(record.toolName ?? record.tool);
  const timestamp = isoTimestamp(record.completedAt ?? record.timestamp ?? record.startedAt);
  const title = kind === "action"
    ? compactTitle([action ?? "Action", status].filter(Boolean).join(" "))
    : humanizeEvent(rawEvent);

  const diffRecord = asRecord(record.diff);

  return stripUndefined({
    id: `trace:${missionRunId}:${index}`,
    missionRunId,
    missionId,
    kind,
    source: "dynamic_trace",
    event: rawEvent,
    title,
    timestamp,
    sequence: 10_000 + index,
    status,
    actor: stringOrNull(record.actor ?? record.changedBy ?? record.type),
    summary: buildTraceSummary(record, kind),
    cycle: numberOrNull(record.cycle),
    traceCycleId: stringOrNull(record.traceCycleId),
    action,
    toolName,
    payload: options.includePayloads ? entry : undefined,
    snapshotDiff: Object.keys(diffRecord).length > 0 ? {
      blackboard: asRecord(diffRecord.blackboard) as any,
      missionContext: asRecord(diffRecord.missionContext) as any,
    } : undefined,
    evidence: {
      traceIndex: index,
      actionId: stringOrNull(record.actionId) ?? undefined,
    },
  });
}

export function normalizeTrycuaStep(
  row: Record<string, unknown>,
  index: number,
  missionRunId: number,
  missionId?: number | null,
  options: { includePayloads?: boolean } = {},
): MissionEvidenceEvent {
  const status = stringOr(row.status, "unknown");
  const phase = stringOrNull(row.phase);
  const action = stringOrNull(row.action);
  const stepNum = numberOrNull(row.stepNumber) ?? index;

  return stripUndefined({
    id: `trycua:${row.id ?? missionRunId}:${stepNum}`,
    missionRunId,
    missionId,
    kind: "computer_use" as MissionEvidenceEventKind,
    source: "trycua_step",
    event: `trycua.step.${status}`,
    title: compactTitle(`CUA Step ${stepNum}: ${action ?? phase ?? status}`),
    timestamp: isoTimestamp(row.createdAt),
    sequence: 50_000 + stepNum,
    status,
    actor: stringOrNull(row.userId),
    summary: [
      action ? `Action: ${action}` : undefined,
      phase ? `Phase: ${phase}` : undefined,
      stringOrNull(row.decision) ? `Decision: ${row.decision}` : undefined,
      stringOrNull(row.error) ? `Error: ${row.error}` : undefined,
    ].filter(Boolean).join(" | ") || undefined,
    payload: options.includePayloads ? { observation: row.observation, result: row.result, plan: row.plan } : undefined,
    evidence: {
      table: "trycua_computer_use_task_steps",
      rowId: stringOrNull(row.id) ?? undefined,
    },
  });
}

export function normalizeCheckpoint(
  row: Record<string, unknown>,
  index: number,
  missionRunId: number,
  missionId?: number | null,
  options: { includePayloads?: boolean } = {},
): MissionEvidenceEvent {
  const reason = stringOrNull(row.changeReason);
  const keys = objectKeys(row.blackboard);
  const label = reason ? reason.replace(/^checkpoint:/, "") : "checkpoint";

  return stripUndefined({
    id: `checkpoint:${row.id ?? missionRunId}:${index}`,
    missionRunId,
    missionId: numberOrNull(row.missionId) ?? missionId,
    kind: "checkpoint",
    source: "blackboard_history",
    event: reason ?? "checkpoint",
    title: compactTitle(`Checkpoint: ${humanizeEvent(label)}`),
    timestamp: isoTimestamp(row.createdAt),
    sequence: 20_000 + index,
    actor: stringOrNull(row.changedBy),
    summary: keys.length > 0 ? `Blackboard keys: ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? "..." : ""}` : undefined,
    payload: options.includePayloads ? { blackboard: row.blackboard } : undefined,
    evidence: {
      table: "mission_blackboard_history",
      rowId: numberOrNull(row.id),
    },
  });
}

export function normalizeApproval(
  row: Record<string, unknown>,
  missionRunId: number,
  missionId?: number | null,
  options: { includePayloads?: boolean } = {},
): MissionEvidenceEvent {
  const status = stringOr(row.status, "pending");
  const decided = Boolean(row.decisionAt) && status !== "pending";
  const event = decided ? `approval.${status}` : "approval.requested";
  const approver = stringOrNull(row.approverEmail ?? row.approverId);
  const decision = stringOrNull(row.decision);
  const comments = stringOrNull(row.comments);

  return stripUndefined({
    id: `approval:${row.id ?? missionRunId}`,
    missionRunId,
    missionId: numberOrNull(row.missionId) ?? missionId,
    kind: "approval",
    source: "approval_request",
    event,
    title: compactTitle(decided ? `Approval ${status}` : "Approval requested"),
    timestamp: isoTimestamp(row.decisionAt ?? row.createdAt),
    sequence: 30_000 + (Number(row.id) || 0),
    status,
    actor: approver,
    summary: [decision, comments].filter(Boolean).join(" | ") || undefined,
    payload: options.includePayloads ? {
      modifiedOutput: row.modifiedOutput,
      selectionList: row.selectionList,
    } : undefined,
    evidence: {
      table: "approval_requests",
      rowId: numberOrNull(row.id),
    },
  });
}

export function normalizeEventLog(
  row: Record<string, unknown>,
  missionRunId: number,
  missionId?: number | null,
  options: { includePayloads?: boolean } = {},
): MissionEvidenceEvent {
  const type = stringOr(row.type, "event");

  return stripUndefined({
    id: `event:${row.eventId ?? row.id ?? missionRunId}`,
    missionRunId,
    missionId,
    kind: "event",
    source: "event_log",
    event: type,
    title: humanizeEvent(type),
    timestamp: isoTimestamp(row.emittedAt),
    sequence: 40_000 + (Number(row.id) || 0),
    actor: stringOrNull(row.source),
    summary: stringOrNull(row.subject) ? `Subject: ${row.subject}` : undefined,
    payload: options.includePayloads ? row.payload : undefined,
    evidence: {
      table: "event_log",
      rowId: numberOrNull(row.id),
      eventId: stringOrNull(row.eventId) ?? undefined,
    },
  });
}

export function sortEvidenceEvents(events: MissionEvidenceEvent[], direction: MissionEvidenceDirection = "desc"): MissionEvidenceEvent[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...events].sort((a, b) => {
    const timeDelta = (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) * factor;
    if (timeDelta !== 0) return timeDelta;
    return (a.sequence - b.sequence) * factor;
  });
}

export const missionEvidenceTimelineService = {
  async getEvidenceTimeline(
    missionRunId: number,
    options: {
      organizationId?: number;
      limit?: number;
      direction?: MissionEvidenceDirection;
      includePayloads?: boolean;
      kinds?: MissionEvidenceEventKind[];
      from?: string;
      to?: string;
    } = {},
  ): Promise<MissionEvidenceTimeline> {
    const direction = options.direction ?? "desc";
    const limit = clampLimit(options.limit);
    const runConditions = [eq(missionRuns.id, missionRunId), isNull(missionRuns.deletedAt)];
    if (options.organizationId != null) {
      runConditions.push(eq(missionRuns.organizationId, options.organizationId));
    }

    const [run] = await db
      .select()
      .from(missionRuns)
      .where(and(...runConditions))
      .limit(1);

    if (!run) {
      throw new NotFoundError("Mission Run not found");
    }

    const missionId = run.missionId ?? null;
    const orgId = run.organizationId ?? options.organizationId ?? null;

    // Derive Trycua task IDs referenced in the blackboard
    const trycuaTaskIds = extractTrycuaTaskIds(run.dynamicTrace as unknown[] ?? []);

    const [checkpoints, approvals, eventLogEntries, trycuaSteps] = await Promise.all([
      fetchCheckpoints(missionRunId, missionId, limit),
      fetchApprovals(missionRunId, missionId, orgId, limit),
      fetchEventLogEntries(missionRunId, missionId, orgId, limit),
      trycuaTaskIds.length > 0 ? fetchTrycuaSteps(trycuaTaskIds, limit) : Promise.resolve([]),
    ]);

    const events = buildMissionEvidenceTimeline({
      run: run as Record<string, unknown>,
      dynamicTrace: Array.isArray(run.dynamicTrace) ? run.dynamicTrace : [],
      checkpoints,
      approvals,
      eventLogEntries,
      trycuaSteps,
    }, {
      direction,
      includePayloads: options.includePayloads,
      limit,
      kinds: options.kinds,
      from: options.from,
      to: options.to,
    });

    return {
      missionRunId,
      missionId,
      generatedAt: new Date().toISOString(),
      direction,
      limit,
      events,
    };
  },
};

async function fetchCheckpoints(missionRunId: number, missionId: number | null, limit: number) {
  const scope = missionId == null
    ? eq(missionBlackboardHistory.missionRunId, missionRunId)
    : or(
      eq(missionBlackboardHistory.missionRunId, missionRunId),
      and(
        eq(missionBlackboardHistory.missionId, missionId),
        isNull(missionBlackboardHistory.missionRunId),
      ),
    );

  return await db
    .select()
    .from(missionBlackboardHistory)
    .where(and(
      scope,
      sql`${missionBlackboardHistory.changeReason} IS NOT NULL`,
    ))
    .orderBy(desc(missionBlackboardHistory.createdAt))
    .limit(limit * 2);
}

async function fetchApprovals(
  missionRunId: number,
  missionId: number | null,
  organizationId: number | null,
  limit: number,
) {
  const pipelineExecutionIds = await fetchPipelineExecutionIds(missionRunId, missionId);
  const stepExecutionIds = pipelineExecutionIds.length === 0
    ? []
    : await db
      .select({ id: pipelineStepExecutions.id })
      .from(pipelineStepExecutions)
      .where(inArray(pipelineStepExecutions.pipelineExecutionId, pipelineExecutionIds))
      .limit(limit * 4);

  const identityConditions = [
    eq(approvalRequests.executionId, String(missionRunId)),
    eq(approvalRequests.executionId, `mission-run:${missionRunId}`),
    eq(approvalRequests.executionId, `mission_run:${missionRunId}`),
  ];

  if (missionId != null) {
    identityConditions.push(eq(approvalRequests.missionId, missionId));
  }

  const stepExecutionIdStrings = stepExecutionIds.map((row) => String(row.id));
  if (stepExecutionIdStrings.length > 0) {
    identityConditions.push(inArray(approvalRequests.executionId, stepExecutionIdStrings));
  }

  const conditions = [or(...identityConditions)];
  if (organizationId != null) {
    conditions.push(eq(approvalRequests.organizationId, organizationId));
  }

  return await db
    .select()
    .from(approvalRequests)
    .where(and(...conditions))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(limit * 2);
}

async function fetchEventLogEntries(
  missionRunId: number,
  missionId: number | null,
  organizationId: number | null,
  limit: number,
) {
  const subjectConditions = [
    eq(eventLog.subject, `mission-run:${missionRunId}`),
    eq(eventLog.subject, `missionRun:${missionRunId}`),
    eq(eventLog.subject, String(missionRunId)),
    sql`${eventLog.payload}->>'missionRunId' = ${String(missionRunId)}`,
    sql`${eventLog.payload}->>'mission_run_id' = ${String(missionRunId)}`,
  ];

  if (missionId != null) {
    subjectConditions.push(
      eq(eventLog.subject, `mission:${missionId}`),
      sql`${eventLog.payload}->>'missionId' = ${String(missionId)}`,
      sql`${eventLog.payload}->>'mission_id' = ${String(missionId)}`,
    );
  }

  const conditions = [or(...subjectConditions)];
  if (organizationId != null) {
    conditions.push(or(eq(eventLog.organizationId, organizationId), isNull(eventLog.organizationId)));
  }

  return await db
    .select()
    .from(eventLog)
    .where(and(...conditions))
    .orderBy(desc(eventLog.emittedAt))
    .limit(limit * 2);
}

async function fetchPipelineExecutionIds(missionRunId: number, missionId: number | null): Promise<number[]> {
  const scope = missionId == null
    ? eq(pipelineExecutions.missionRunId, missionRunId)
    : or(
      eq(pipelineExecutions.missionRunId, missionRunId),
      eq(pipelineExecutions.missionId, missionId),
    );

  const rows = await db
    .select({ id: pipelineExecutions.id })
    .from(pipelineExecutions)
    .where(and(scope, isNull(pipelineExecutions.deletedAt)))
    .limit(200);

  return rows.map((row) => row.id);
}

function normalizeRunEvents(
  run: Record<string, unknown>,
  missionRunId: number,
  missionId: number | null,
  includePayloads: boolean,
): MissionEvidenceEvent[] {
  const status = stringOr(run.status, "active");
  const createdAt = isoTimestamp(run.createdAt);
  const events: MissionEvidenceEvent[] = [{
    id: `run:${missionRunId}:created`,
    missionRunId,
    missionId,
    kind: "run",
    source: "mission_run",
    event: "run.created",
    title: "Mission run created",
    timestamp: createdAt,
    sequence: 0,
    status,
    actor: stringOrNull(run.createdBy),
    summary: stringOrNull(run.name) ?? undefined,
    payload: includePayloads ? run : undefined,
    evidence: {
      table: "mission_runs",
      rowId: missionRunId,
    },
  }];

  if (status !== "active" && run.updatedAt) {
    events.push({
      id: `run:${missionRunId}:status`,
      missionRunId,
      missionId,
      kind: "run",
      source: "mission_run",
      event: `run.${status}`,
      title: compactTitle(`Mission run ${status.replaceAll("_", " ")}`),
      timestamp: isoTimestamp(run.updatedAt),
      sequence: 1,
      status,
      actor: stringOrNull(run.createdBy),
      summary: stringOrNull(run.failureReason) ?? undefined,
      payload: includePayloads ? {
        status,
        failureReason: run.failureReason,
        resumeCondition: run.resumeCondition,
      } : undefined,
      evidence: {
        table: "mission_runs",
        rowId: missionRunId,
      },
    });
  }

  return events.map(stripUndefined);
}

function buildTraceSummary(record: Record<string, unknown>, kind: MissionEvidenceEventKind): string | undefined {
  const note = stringOrNull(record.note);
  const error = stringOrNull(record.error);
  const pauseReason = stringOrNull(record.pauseReason);
  const latency = numberOrNull(record.latencyMs);
  const diff = asRecord(record.diff);
  const changedKeys = [
    ...objectKeys(asRecord(diff.blackboard)).flatMap((bucket) => (diff.blackboard as any)?.[bucket] ?? []),
    ...objectKeys(asRecord(diff.missionContext)).flatMap((bucket) => (diff.missionContext as any)?.[bucket] ?? []),
  ].filter((value, index, all) => typeof value === "string" && all.indexOf(value) === index);

  const parts = [
    note,
    error ? `Error: ${error}` : undefined,
    pauseReason ? `Paused: ${pauseReason}` : undefined,
    kind === "action" && changedKeys.length > 0 ? `Changed: ${changedKeys.slice(0, 8).join(", ")}` : undefined,
    latency != null ? `${latency}ms` : undefined,
  ].filter(Boolean);

  return parts.join(" | ") || undefined;
}

function statusFromTrace(record: Record<string, unknown>): string | null {
  if (typeof record.success === "boolean") return record.success ? "succeeded" : "failed";
  if (record.event === "execution_failed" || record.type === "error") return "failed";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function objectKeys(value: unknown): string[] {
  return Object.keys(asRecord(value)).sort();
}

function stringOr(value: unknown, fallback: string): string {
  return stringOrNull(value) ?? fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(0).toISOString();
}

function compactTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  return title.length > 96 ? `${title.slice(0, 93)}...` : title;
}

function humanizeEvent(value: string): string {
  const cleaned = value
    .replace(/^checkpoint:/, "")
    .replace(/[._:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Event";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(500, Math.trunc(limit ?? 100)));
}

function stripUndefined<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

async function fetchTrycuaSteps(taskIds: string[], limit: number): Promise<Array<Record<string, unknown>>> {
  if (taskIds.length === 0) return [];
  const rows = await db
    .select()
    .from(trycuaComputerUseTaskSteps)
    .where(inArray(trycuaComputerUseTaskSteps.taskId, taskIds))
    .orderBy(desc(trycuaComputerUseTaskSteps.createdAt))
    .limit(limit * 4);
  return rows as unknown as Array<Record<string, unknown>>;
}

/** Extract Trycua task UUIDs stored in the dynamic trace via tool output keys. */
function extractTrycuaTaskIds(dynamicTrace: unknown[]): string[] {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = new Set<string>();
  for (const entry of dynamicTrace) {
    const record = asRecord(entry);
    // tool_output from trycua tool calls may contain { id: "<uuid>", taskId: "<uuid>" }
    if (record.toolName === "create_trycua_task" || record.toolName === "run_trycua_autonomous_loop") {
      const result = asRecord(record.toolResult ?? record.payload);
      const id = stringOrNull(result.id ?? result.taskId);
      if (id && uuidRe.test(id)) ids.add(id);
    }
    // Also scan flat result objects
    if (record.event === "tool_success" || record.status === "succeeded") {
      const payload = asRecord(record.payload ?? record.result ?? record.toolResult);
      const id = stringOrNull(payload.taskId ?? payload.id);
      if (id && uuidRe.test(id) && stringOrNull(payload.task)) ids.add(id);
    }
  }
  return [...ids];
}
