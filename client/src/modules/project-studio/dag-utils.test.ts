import { describe, it, expect } from "vitest";
import { detectCycles, validateWavePlan, autoBalanceCriticalPath } from "./dag-utils";
import type { WavePlanItem } from "./types";

const makeWave = (id: string, name: string, hours: number, deps: string[] = [], cost = 1.0, isCritical = false): WavePlanItem => ({
  id,
  name,
  waveNumber: 1,
  objective: `Objective ${id}`,
  isCriticalPath: isCritical,
  estimatedDurationHours: hours,
  dependencies: deps,
  assignee: {
    type: "agent",
    name: "Agent Test",
    role: "Tester",
    estimatedCostUsd: cost,
  },
});

describe("dag-utils Module Suite", () => {
  describe("detectCycles", () => {
    it("returns false for linear DAG", () => {
      const waves = [
        makeWave("w1", "Wave 1", 10),
        makeWave("w2", "Wave 2", 15, ["w1"]),
        makeWave("w3", "Wave 3", 20, ["w2"]),
      ];
      const result = detectCycles(waves);
      expect(result.hasCycle).toBe(false);
      expect(result.cycleNodeIds).toEqual([]);
    });

    it("detects direct 2-node circular dependency", () => {
      const waves = [
        makeWave("w1", "Wave 1", 10, ["w2"]),
        makeWave("w2", "Wave 2", 15, ["w1"]),
      ];
      const result = detectCycles(waves);
      expect(result.hasCycle).toBe(true);
      expect(result.cycleNodeIds.length).toBeGreaterThan(0);
    });

    it("detects multi-node circular dependency loop", () => {
      const waves = [
        makeWave("w1", "Wave 1", 10, ["w3"]),
        makeWave("w2", "Wave 2", 15, ["w1"]),
        makeWave("w3", "Wave 3", 20, ["w2"]),
      ];
      const result = detectCycles(waves);
      expect(result.hasCycle).toBe(true);
    });
  });

  describe("validateWavePlan", () => {
    it("flags budget ceiling overrun", () => {
      const waves = [
        makeWave("w1", "Wave 1", 10, [], 60),
        makeWave("w2", "Wave 2", 10, [], 50),
      ];
      const result = validateWavePlan(waves, 100, 5);
      expect(result.isBudgetExceeded).toBe(true);
      expect(result.totalCostUsd).toBe(110);
      expect(result.warnings.some((w) => w.includes("Budget ceiling exceeded"))).toBe(true);
    });

    it("flags SLA target overrun on critical path", () => {
      const waves = [
        makeWave("w1", "Wave 1", 50, [], 10, true), // 50 hours on critical path > 5d * 8h = 40h
      ];
      const result = validateWavePlan(waves, 200, 5);
      expect(result.isSlaExceeded).toBe(true);
      expect(result.criticalPathHours).toBe(50);
      expect(result.warnings.some((w) => w.includes("Critical path SLA overrun"))).toBe(true);
    });
  });

  describe("autoBalanceCriticalPath", () => {
    it("correctly identifies the longest dependency path as critical path", () => {
      // Path A: w1 (10h) -> w2 (20h) = 30h
      // Path B: w3 (5h) -> w4 (5h) = 10h
      const waves = [
        makeWave("w1", "Wave 1", 10, []),
        makeWave("w2", "Wave 2", 20, ["w1"]),
        makeWave("w3", "Wave 3", 5, []),
        makeWave("w4", "Wave 4", 5, ["w3"]),
      ];

      const balanced = autoBalanceCriticalPath(waves);
      const criticalMap = Object.fromEntries(balanced.map((w) => [w.id, w.isCriticalPath]));

      expect(criticalMap["w1"]).toBe(true);
      expect(criticalMap["w2"]).toBe(true);
      expect(criticalMap["w3"]).toBe(false);
      expect(criticalMap["w4"]).toBe(false);
    });
  });
});
