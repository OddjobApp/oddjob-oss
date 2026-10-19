/**
 * Unit tests for the dependency gateway's configurable timeout + graduated
 * escalation (#3). DB / event-stream / drizzle are mocked so the test exercises
 * the control flow (warn→alert→escalate, on_timeout policy) with short real timers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const publish = vi.fn().mockResolvedValue(undefined);

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
  eventStream: { publish: (...args: any[]) => publish(...args) },
}));

// No existing run → fast path falls through to the wait loop.
vi.mock("@server/database_service.js", () => ({
  db: {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [] }) }) }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

vi.mock("@shared/schema/index.js", () => ({ cycleDependencyGates: {}, missionRuns: {}, missions: {} }));
// Spread the real module rather than replacing it. Listing three helpers meant
// the mock had to be edited every time anything in the import graph reached for
// a fourth — it broke on `sql`, and the whole file stopped collecting.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
}));

import { cycleDependencyGatewayService } from "./cycle-dependency-gateway.service.js";

beforeEach(() => publish.mockClear());

describe("waitForDependency — timeout policy (#3)", () => {
  it("proceeds (resolves) on timeout when onTimeout=continue", async () => {
    await expect(
      cycleDependencyGatewayService.waitForDependency(1, "A", "B", "finish_to_start", 0, "plus", {
        timeoutMs: 60, onTimeout: "continue",
      })
    ).resolves.toBeUndefined();
  });

  it("rejects on timeout when onTimeout defaults to fail", async () => {
    await expect(
      cycleDependencyGatewayService.waitForDependency(1, "A", "B", "finish_to_start", 0, "plus", {
        timeoutMs: 60,
      })
    ).rejects.toThrow(/timeout/i);
  });

  it("emits graduated escalation events (warn / alert / escalated)", async () => {
    await cycleDependencyGatewayService
      .waitForDependency(2, "A", "B", "finish_to_start", 0, "plus", { timeoutMs: 120, onTimeout: "continue", organizationId: 5 })
      .catch(() => {});

    const stages = publish.mock.calls
      .filter((c) => c[0] === "cycle.dependency_timeout")
      .map((c) => c[1]?.stage);
    expect(stages).toContain("warned");
    expect(stages).toContain("alerted");
    expect(stages).toContain("escalated");
    // escalated event records the triage target
    const escalated = publish.mock.calls.find((c) => c[0] === "cycle.dependency_timeout" && c[1]?.stage === "escalated");
    expect(escalated?.[1]?.escalatedTo).toBe("scrum-master");
  });

  it("resolves immediately when the upstream signal fires before timeout", async () => {
    const p = cycleDependencyGatewayService.waitForDependency(3, "A", "B", "finish_to_start", 0, "plus", { timeoutMs: 5000 });
    // Let the gate finish persisting + register its emitter listener before signaling
    // (in real flow the upstream completes long after the downstream starts waiting).
    await new Promise((r) => setTimeout(r, 30));
    // Fire the gate signal the way onMissionStatusChange would for a completed FTS dep.
    await cycleDependencyGatewayService.onMissionStatusChange(3, "A", "completed");
    await expect(p).resolves.toBeUndefined();
    // No escalation events should have been emitted
    expect(publish.mock.calls.filter((c) => c[0] === "cycle.dependency_timeout")).toHaveLength(0);
  });

  it("rejects immediately when the upstream signal fires a failed status", async () => {
    const p = cycleDependencyGatewayService.waitForDependency(3, "A", "B", "finish_to_start", 0, "plus", { timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 30));
    // Fire the gate signal the way onMissionStatusChange would for a failed FTS dep.
    await cycleDependencyGatewayService.onMissionStatusChange(3, "A", "failed");
    await expect(p).rejects.toThrow(/Dependency failed: A terminated with status failed/i);
  });
});
