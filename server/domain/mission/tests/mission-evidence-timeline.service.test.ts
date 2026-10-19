import { describe, expect, it } from "vitest";
import {
  buildMissionEvidenceTimeline,
  normalizeApproval,
  normalizeCheckpoint,
  normalizeDynamicTraceEntry,
  sortEvidenceEvents,
} from "../core/mission-evidence-timeline.service.js";

describe("mission evidence timeline", () => {
  it("normalizes action runtime trace entries as first-class action evidence", () => {
    const event = normalizeDynamicTraceEntry({
      type: "action_execution",
      event: "action_succeeded",
      actionId: "42:3:CALL_TOOL:1",
      action: "CALL_TOOL",
      toolName: "google_search",
      status: "succeeded",
      cycle: 3,
      traceCycleId: "42:3",
      completedAt: "2026-01-03T10:30:00.000Z",
      latencyMs: 128,
      diff: {
        blackboard: { added: ["answer"], changed: [], removed: [] },
        missionContext: { added: [], changed: ["cycleCount"], removed: [] },
      },
    }, 0, 42, 7);

    expect(event).toMatchObject({
      id: "trace:42:0",
      kind: "action",
      source: "dynamic_trace",
      event: "action_succeeded",
      status: "succeeded",
      action: "CALL_TOOL",
      toolName: "google_search",
      cycle: 3,
      traceCycleId: "42:3",
      timestamp: "2026-01-03T10:30:00.000Z",
      evidence: {
        traceIndex: 0,
        actionId: "42:3:CALL_TOOL:1",
      },
    });
    expect(event.summary).toContain("Changed: answer, cycleCount");
    expect(event.payload).toBeUndefined();
  });

  it("summarizes checkpoints without exposing full blackboard payloads by default", () => {
    const event = normalizeCheckpoint({
      id: 12,
      missionId: 7,
      missionRunId: 42,
      blackboard: { finalProduct: "report", sourceCount: 4 },
      changedBy: "agent:orchestrator",
      changeReason: "checkpoint:hil_submission",
      createdAt: new Date("2026-01-03T10:00:00.000Z"),
    }, 0, 42, 7);

    expect(event).toMatchObject({
      id: "checkpoint:12:0",
      kind: "checkpoint",
      event: "checkpoint:hil_submission",
      title: "Checkpoint: Hil submission",
      actor: "agent:orchestrator",
      timestamp: "2026-01-03T10:00:00.000Z",
      evidence: {
        table: "mission_blackboard_history",
        rowId: 12,
      },
    });
    expect(event.summary).toContain("finalProduct");
    expect(event.summary).toContain("sourceCount");
    expect(event.payload).toBeUndefined();

    const withPayload = normalizeCheckpoint({
      id: 12,
      blackboard: { finalProduct: "report" },
      createdAt: "2026-01-03T10:00:00.000Z",
    }, 0, 42, 7, { includePayloads: true });

    expect(withPayload.payload).toEqual({ blackboard: { finalProduct: "report" } });
  });

  it("normalizes approval status and decision evidence", () => {
    const event = normalizeApproval({
      id: 5,
      missionId: 7,
      status: "approved",
      approverEmail: "ops@example.com",
      decision: "ship",
      comments: "Looks good",
      createdAt: "2026-01-03T09:00:00.000Z",
      decisionAt: "2026-01-03T11:00:00.000Z",
    }, 42, 7);

    expect(event).toMatchObject({
      id: "approval:5",
      kind: "approval",
      event: "approval.approved",
      status: "approved",
      actor: "ops@example.com",
      timestamp: "2026-01-03T11:00:00.000Z",
      evidence: {
        table: "approval_requests",
        rowId: 5,
      },
    });
    expect(event.summary).toBe("ship | Looks good");
  });

  it("sorts deterministically and applies timeline limits", () => {
    const events = buildMissionEvidenceTimeline({
      run: {
        id: 42,
        missionId: 7,
        name: "Mission: verify launch",
        status: "active",
        createdBy: "user-123",
        createdAt: "2026-01-03T08:00:00.000Z",
      },
      dynamicTrace: [{
        type: "system",
        event: "cycle_started",
        timestamp: "2026-01-03T10:00:00.000Z",
      }],
      checkpoints: [{
        id: 1,
        blackboard: { answer: "ok" },
        changeReason: "checkpoint:answer",
        createdAt: "2026-01-03T09:00:00.000Z",
      }],
      eventLogEntries: [{
        id: 9,
        eventId: "evt-9",
        type: "mission.completed",
        source: "mission",
        subject: "mission-run:42",
        payload: {},
        emittedAt: "2026-01-03T11:00:00.000Z",
      }],
    }, { direction: "desc", limit: 3 });

    expect(events.map((event) => event.event)).toEqual([
      "mission.completed",
      "cycle_started",
      "checkpoint:answer",
    ]);

    expect(sortEvidenceEvents(events, "asc").map((event) => event.event)).toEqual([
      "checkpoint:answer",
      "cycle_started",
      "mission.completed",
    ]);
  });
});
