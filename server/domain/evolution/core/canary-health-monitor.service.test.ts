/**
 * Unit Tests for Canary Health Monitor & Automated Rollback Service
 */

import { describe, expect, it, vi } from "vitest";
import {
  CanaryHealthMonitorService,
  canaryHealthMonitorService,
} from "./canary-health-monitor.service.js";
import type { EvolutionLifecycleService } from "./evolution-lifecycle.service.js";

describe("CanaryHealthMonitorService", () => {
  describe("evaluateCanaryHealth", () => {
    it("returns healthy for zero errors and low latency", () => {
      const evalResult = canaryHealthMonitorService.evaluateCanaryHealth({
        totalObservations: 50,
        errorCount: 0,
        p99LatencyMs: 180,
        sloBreachCount: 0,
      });

      expect(evalResult.healthy).toBe(true);
      expect(evalResult.shouldRollback).toBe(false);
      expect(evalResult.errorRate).toBe(0);
      expect(evalResult.readyForPromotion).toBe(false); // Needs 100 observations
    });

    it("marks readyForPromotion when >= 100 observations with 0 errors", () => {
      const evalResult = canaryHealthMonitorService.evaluateCanaryHealth({
        totalObservations: 120,
        errorCount: 0,
        p99LatencyMs: 250,
        sloBreachCount: 0,
      });

      expect(evalResult.healthy).toBe(true);
      expect(evalResult.shouldRollback).toBe(false);
      expect(evalResult.readyForPromotion).toBe(true);
    });

    it("triggers rollback when error rate exceeds 5%", () => {
      const evalResult = canaryHealthMonitorService.evaluateCanaryHealth({
        totalObservations: 100,
        errorCount: 8, // 8% error rate
        p99LatencyMs: 300,
        sloBreachCount: 2,
      });

      expect(evalResult.healthy).toBe(false);
      expect(evalResult.shouldRollback).toBe(true);
      expect(evalResult.errorRate).toBe(0.08);
      expect(evalResult.reason).toContain("exceeded maximum threshold");
    });

    it("triggers rollback when p99 latency exceeds 1500ms", () => {
      const evalResult = canaryHealthMonitorService.evaluateCanaryHealth({
        totalObservations: 50,
        errorCount: 0,
        p99LatencyMs: 2200,
        sloBreachCount: 1,
      });

      expect(evalResult.healthy).toBe(false);
      expect(evalResult.shouldRollback).toBe(true);
      expect(evalResult.reason).toContain("latency 2200ms exceeded threshold");
    });
  });

  describe("enforceCanaryGate", () => {
    it("executes automated rollback to shadow stage on health failure", async () => {
      const mockLifecycle = {
        getCurrentStage: vi.fn().mockResolvedValue({ phenotypeId: "p1", stage: "canary" }),
        transition: vi.fn().mockResolvedValue({
          eventId: "evt-123",
          from: "canary",
          to: "shadow",
          action: "rollback",
        }),
      } as unknown as EvolutionLifecycleService;

      const result = await canaryHealthMonitorService.enforceCanaryGate(
        1,
        "p1",
        {
          totalObservations: 100,
          errorCount: 10, // 10% error
          p99LatencyMs: 300,
          sloBreachCount: 1,
        },
        mockLifecycle,
      );

      expect(result.actionTaken).toBe("rollback");
      expect(result.currentStage).toBe("canary");
      expect(result.targetStage).toBe("shadow");
      expect(mockLifecycle.transition).toHaveBeenCalledWith(
        1,
        "p1",
        expect.objectContaining({
          action: "rollback",
          evidence: expect.objectContaining({ rollbackTarget: "shadow" }),
        }),
        "canary-health-monitor",
      );
    });

    it("takes no action when phenotype is not in canary stage", async () => {
      const mockLifecycle = {
        getCurrentStage: vi.fn().mockResolvedValue({ phenotypeId: "p2", stage: "shadow" }),
        transition: vi.fn(),
      } as unknown as EvolutionLifecycleService;

      const result = await canaryHealthMonitorService.enforceCanaryGate(
        1,
        "p2",
        {
          totalObservations: 100,
          errorCount: 20,
          p99LatencyMs: 3000,
          sloBreachCount: 5,
        },
        mockLifecycle,
      );

      expect(result.actionTaken).toBe("none");
      expect(result.currentStage).toBe("shadow");
      expect(mockLifecycle.transition).not.toHaveBeenCalled();
    });
  });
});
