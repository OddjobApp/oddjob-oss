/**
 * Unit Tests for Dual-Vector Retrospective RAG (Golden Path & Anti-Pattern Contrastive Steering)
 */

import { describe, expect, it } from "vitest";
import { steeringVectorService } from "../steering-vector.service.js";
import type { SteeringVector } from "../steering-vector.types.js";

describe("Dual-Vector Retrospective RAG (Level 4)", () => {
  it("builds a prompt steering block with both proven strategies and anti-patterns", () => {
    const vector: SteeringVector = {
      dimensions: [
        { name: "creativity", weight: 0.8, source: "ocean", updatedAt: new Date().toISOString() },
        { name: "risk_aversion", weight: 0.2, source: "ocean", updatedAt: new Date().toISOString() },
      ],
      alpha: 0.8,
      goldenPathId: 101,
      goldenPathSnippet: "1. Inspect database schema before running migrations.\n2. Apply idempotent indices.",
      antiPatternId: 202,
      antiPatternSnippet: "Failure: Dropped index during peak traffic causing connection starvation. Do not drop active tables.",
      humanNudge: "Ensure 100% test coverage before proposing changes.",
      entropyAtResolution: 0.15,
      resolvedAt: new Date().toISOString(),
    };

    const promptBlock = steeringVectorService.buildSteeringBlock(vector);

    expect(promptBlock).toContain("## PROVEN STRATEGY (follow this approach)");
    expect(promptBlock).toContain("Apply idempotent indices");

    expect(promptBlock).toContain("## PROVEN ANTI-PATTERNS (DO NOT ATTEMPT — known failure modes)");
    expect(promptBlock).toContain("Dropped index during peak traffic");

    expect(promptBlock).toContain("Strongly prioritize creativity");
    expect(promptBlock).toContain("Minimize risk_aversion");
    expect(promptBlock).toContain("HUMAN DIRECTIVE (CRITICAL — override other guidance)");
  });

  it("suppresses steering blocks when alpha is below minimum threshold", () => {
    const vector: SteeringVector = {
      dimensions: [],
      alpha: 0.05,
      goldenPathSnippet: "Some SOP",
      antiPatternSnippet: "Some Failure",
      entropyAtResolution: 0.1,
      resolvedAt: new Date().toISOString(),
    };

    const promptBlock = steeringVectorService.buildSteeringBlock(vector);
    expect(promptBlock).toBe("");
  });

  it("builds structured trace entries containing both goldenPathId and antiPatternId", () => {
    const vector: SteeringVector = {
      dimensions: [{ name: "thoroughness", weight: 0.9, source: "default", updatedAt: new Date().toISOString() }],
      alpha: 0.75,
      goldenPathId: 55,
      antiPatternId: 66,
      humanNudge: undefined,
      entropyAtResolution: 0.2,
      resolvedAt: new Date().toISOString(),
    };

    const trace = steeringVectorService.buildTraceEntry(vector, 2);
    expect(trace.type).toBe("steering");
    expect(trace.cycle).toBe(2);
    expect(trace.alpha).toBe(0.75);
    expect(trace.goldenPathId).toBe(55);
    expect(trace.antiPatternId).toBe(66);
    expect(trace.hasHumanNudge).toBe(false);
  });
});
