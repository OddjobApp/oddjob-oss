import { describe, it, expect, vi, beforeEach } from "vitest";
import { steeringVectorService } from "@domain/ai/core/steering-vector.service.js";

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: {
    setex: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue(null),
  },
}));

describe("SteeringVectorService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildSteeringBlock", () => {
    it("should return empty string when alpha < 0.1", () => {
      const result = steeringVectorService.buildSteeringBlock({
        alpha: 0.05,
        dimensions: [{ name: "creativity", weight: 0.9, source: "ocean", updatedAt: "2026-07-29" }],
        goldenPathId: null,
        goldenPathSnippet: null,
        humanNudge: null,
        resolvedAt: "2026-07-29",
        entropyAtResolution: 0.2,
      });

      expect(result).toBe("");
    });

    it("should format behavioral directives and human nudges when alpha >= 0.1", () => {
      const result = steeringVectorService.buildSteeringBlock({
        alpha: 0.8,
        dimensions: [{ name: "creativity", weight: 0.95, source: "ocean", updatedAt: "2026-07-29" }],
        goldenPathId: null,
        goldenPathSnippet: "Use strict TypeScript interfaces",
        humanNudge: "Prioritize memory efficiency",
        resolvedAt: "2026-07-29",
        entropyAtResolution: 0.2,
      });

      expect(result).toContain("PROVEN STRATEGY");
      expect(result).toContain("BEHAVIORAL DIRECTIVES");
      expect(result).toContain("Prioritize memory efficiency");
    });
  });

  describe("recordCritiqueFeedback", () => {
    it("should calibrate alpha to 0.85 when critique score is below 60", async () => {
      await steeringVectorService.recordCritiqueFeedback(100, 45, "Low safety consensus");

      const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
      expect(redis.setex).toHaveBeenCalledWith(
        "steering:feedback:100",
        3600,
        expect.stringContaining('"calibratedAlpha":0.85')
      );
    });

    it("should calibrate alpha to 0.5 when critique score is high", async () => {
      await steeringVectorService.recordCritiqueFeedback(101, 90, "High consensus");

      const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
      expect(redis.setex).toHaveBeenCalledWith(
        "steering:feedback:101",
        3600,
        expect.stringContaining('"calibratedAlpha":0.5')
      );
    });
  });

  describe("buildTraceEntry", () => {
    it("should construct a valid trace log entry", () => {
      const entry = steeringVectorService.buildTraceEntry(
        {
          alpha: 0.7,
          dimensions: [{ name: "thoroughness", weight: 0.8, source: "ocean", updatedAt: "2026-07-29" }],
          goldenPathId: 12,
          goldenPathSnippet: "SOP text",
          humanNudge: null,
          resolvedAt: "2026-07-29T12:00:00Z",
          entropyAtResolution: 0.15,
        },
        3
      );

      expect(entry.type).toBe("steering");
      expect(entry.cycle).toBe(3);
      expect(entry.alpha).toBe(0.7);
      expect(entry.goldenPathId).toBe(12);
      expect(entry.hasHumanNudge).toBe(false);
    });
  });
});
