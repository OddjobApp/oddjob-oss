/**
 * Unit Tests for Transference Engine Level 3 (Fidelity & Drift Metrics)
 */

import { describe, expect, it } from "vitest";
import {
  evaluateFidelity,
  computeDriftMetrics,
} from "./transference-router.js";

describe("Transference Engine (Level 2 → Level 3)", () => {
  describe("evaluateFidelity", () => {
    it("recognizes exact and case-insensitive string matches", () => {
      const res = evaluateFidelity("Approved", "approved");
      expect(res.isMatch).toBe(true);
      expect(res.score).toBe(1.0);
    });

    it("evaluates structural JSON equality regardless of formatting", () => {
      const pred = '{"action": "deploy", "target": "staging"}';
      const truth = '{\n  "action": "deploy",\n  "target": "staging"\n}';
      const res = evaluateFidelity(pred, truth);
      expect(res.isMatch).toBe(true);
      expect(res.score).toBe(1.0);
    });

    it("recognizes semantic containment as near match", () => {
      const pred = "Database migration completed";
      const truth = "Database migration completed successfully in 120ms.";
      const res = evaluateFidelity(pred, truth);
      expect(res.isMatch).toBe(true);
      expect(res.score).toBeGreaterThanOrEqual(0.95);
    });

    it("returns false for divergent responses", () => {
      const pred = "Delete user account";
      const truth = "Send email notification";
      const res = evaluateFidelity(pred, truth);
      expect(res.isMatch).toBe(false);
      expect(res.score).toBe(0);
    });
  });

  describe("computeDriftMetrics", () => {
    it("triggers promotion when shadow count >= 500 and accuracy >= 98%", () => {
      const metrics = computeDriftMetrics(500, 5); // 495 / 500 = 99% accuracy
      expect(metrics.accuracy).toBe(99);
      expect(metrics.shouldPromote).toBe(true);
      expect(metrics.driftDetected).toBe(false);
    });

    it("does not promote when sample size is insufficient", () => {
      const metrics = computeDriftMetrics(100, 0); // 100% accuracy, but < 500 samples
      expect(metrics.accuracy).toBe(100);
      expect(metrics.shouldPromote).toBe(false);
    });

    it("triggers demotion when accuracy falls below 90% after warmup", () => {
      const metrics = computeDriftMetrics(100, 20); // 80% accuracy
      expect(metrics.accuracy).toBe(80);
      expect(metrics.shouldDemote).toBe(true);
      expect(metrics.driftDetected).toBe(true);
    });

    it("flags drift when accuracy drops below 95%", () => {
      const metrics = computeDriftMetrics(200, 15); // 92.5% -> 93% accuracy
      expect(metrics.driftDetected).toBe(true);
    });
  });
});
