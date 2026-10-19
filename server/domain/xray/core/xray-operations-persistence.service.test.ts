import { describe, expect, it } from "vitest";
import type { XrayEventEvaluation } from "../types/operational-guide.js";
import {
  operationalEventDeduplicationBucket,
  operationalEventDeduplicationKey,
} from "./xray-operations-persistence.service.js";

function evaluation(evidence: Record<string, unknown>): XrayEventEvaluation {
  return {
    schemaVersion: "1.0.0",
    scope: { id: "agent-training", name: "Agent Training" },
    evaluatedAt: "2026-07-29T18:00:00.000Z",
    event: {
      id: "benchmark_regressed",
      description: "Benchmark regressed",
      severity: "high",
      subjects: ["agent"],
      deduplicationKey: "agent+version+benchmark",
      requiredContext: [],
    },
    subjectNodeId: "agent::7",
    evidence,
    context: {
      schemaVersion: "1.0.0",
      scope: { id: "agent-training", name: "Agent Training" },
      task: "inspect regression",
      generatedAt: "2026-07-29T18:00:00.000Z",
      selection: { seedNodeIds: ["agent::7"], maxGraphHops: 1, truncated: false },
      nodes: [],
      edges: [],
      guardrails: [],
      gaps: [],
      operatingInstructions: [],
      suggestedPrompts: [],
      questions: [],
      unknowns: [],
    },
    disposition: {
      mode: "advisory",
      action: "notify",
      requiresHumanReview: true,
      rationale: "Review required",
    },
  };
}

describe("X-Ray operations persistence helpers", () => {
  it("produces a stable key regardless of evidence property order", () => {
    const left = operationalEventDeduplicationKey(evaluation({
      candidate: 0.81,
      baseline: 0.94,
      nested: { version: "v25", benchmark: "dispatch" },
    }));
    const right = operationalEventDeduplicationKey(evaluation({
      nested: { benchmark: "dispatch", version: "v25" },
      baseline: 0.94,
      candidate: 0.81,
    }));

    expect(left).toBe(right);
  });

  it("changes the key when material evidence changes", () => {
    const left = operationalEventDeduplicationKey(evaluation({ candidate: 0.81 }));
    const right = operationalEventDeduplicationKey(evaluation({ candidate: 0.82 }));
    expect(left).not.toBe(right);
  });

  it("groups events into cooldown buckets", () => {
    const start = operationalEventDeduplicationBucket(
      new Date("2026-07-29T18:00:00.000Z"),
      30,
    );
    const sameWindow = operationalEventDeduplicationBucket(
      new Date("2026-07-29T18:15:00.000Z"),
      30,
    );
    const laterWindow = operationalEventDeduplicationBucket(
      new Date("2026-07-29T18:31:00.000Z"),
      30,
    );

    expect(sameWindow).toBe(start);
    expect(laterWindow).not.toBe(start);
  });
});
