/**
 * Unit Tests for CREW Room Belief State Engine
 */

import { describe, expect, it } from "vitest";
import { extractBeliefState } from "../crew-orchestrator.service.js";

describe("CREW Room Belief State Engine", () => {
  it("extracts verified facts, hypotheses, and constraints into structured state", () => {
    const turns = [
      {
        agentCardId: 1,
        content:
          "The database contains 50,000 customer records. We verified the migration schema yesterday.",
      },
      {
        agentCardId: 2,
        content:
          "The latency spike could be caused by unindexed foreign keys. I suspect connection pool exhaustion is likely.",
      },
      {
        agentCardId: 3,
        content:
          "We must not deploy to production during peak trading hours. We are required to maintain a strict 99.9% uptime SLA.",
      },
    ];

    const state = extractBeliefState(turns);

    expect(state.verifiedFacts.length).toBeGreaterThanOrEqual(1);
    expect(state.verifiedFacts.some(f => f.includes("verified the migration schema"))).toBe(true);

    expect(state.hypotheses.length).toBeGreaterThanOrEqual(1);
    expect(state.hypotheses.some(h => h.includes("connection pool") || h.includes("latency spike"))).toBe(true);

    expect(state.openConstraints.length).toBeGreaterThanOrEqual(1);
    expect(state.openConstraints.some(c => c.includes("must not") || c.includes("required to"))).toBe(true);

    expect(state.updatedAt).toBeDefined();
  });

  it("handles empty discussion without crashing", () => {
    const state = extractBeliefState([]);
    expect(state.verifiedFacts).toEqual([]);
    expect(state.hypotheses).toEqual([]);
    expect(state.openConstraints).toEqual([]);
  });
});
