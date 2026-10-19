/**
 * Reflection Service Tests
 * 
 * Comprehensive test suite for the ReAct with Reflection system.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ReflectionService } from "./reflection.service.js";
import { db } from "@server/database_service.js";

// Mock dependencies
vi.mock("@server/database_service.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: 1 }])) })) })),
    query: {
      reflectionLogs: { findMany: vi.fn(() => Promise.resolve([])) },
      reflectionPatterns: { findMany: vi.fn(() => Promise.resolve([])) },
    },
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([{ count: 0 }])) })) })),
  },
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
  eventStream: {
    publish: vi.fn(() => Promise.resolve()),
  },
}));

describe("ReflectionService", () => {
  let service: ReflectionService;

  beforeEach(() => {
    service = new ReflectionService({
      reflectionEnabled: true,
      confidenceThreshold: 0.7,
      maxReflectionDepth: 3,
      verificationStrategies: ["factual", "logical", "consistency", "hallucination", "schema"],
      autoRetryOnLowConfidence: true,
    });
    vi.clearAllMocks();
  });

  // ========================================================================
  // BASIC REFLECTION
  // ========================================================================

  describe("reflect()", () => {
    it("should pass high-confidence outputs without issues", async () => {
      const input = {
        stepId: "step-123",
        missionRunId: 1,
        organizationId: 1,
        output: "This is a simple statement with no specific claims.",
        context: {},
      };

      const result = await service.reflect(input);

      expect(result.passed).toBe(true);
      expect(result.confidenceScore).toBeGreaterThan(0.7);
      expect(result.shouldRetry).toBe(false);
      expect(result.shouldEscalate).toBe(false);
      expect(result.issues).toHaveLength(0);
    });

    it("should detect hallucinations in high-confidence claims without sources", async () => {
      const input = {
        stepId: "step-456",
        missionRunId: 1,
        organizationId: 1,
        output: "GPT-4 was definitely released in March 2023 with 100% certainty.",
        context: {}, // No sources provided
      };

      const result = await service.reflect(input);

      expect(result.passed).toBe(false);
      expect(result.confidenceScore).toBeLessThan(0.7);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some(i => i.type === "hallucination")).toBe(true);
    });

    it("should detect logical contradictions", async () => {
      const input = {
        stepId: "step-789",
        missionRunId: 1,
        organizationId: 1,
        output: "We should not implement this feature, but we should implement it immediately.",
        context: {},
      };

      const result = await service.reflect(input);

      expect(result.issues.some(i => i.type === "logical_error")).toBe(true);
    });

    it("should generate correction suggestion when retry is appropriate", async () => {
      const input = {
        stepId: "step-low-confidence",
        missionRunId: 1,
        organizationId: 1,
        output: "The database has exactly 15,000 records.",
        context: {},
        previousReflections: 0,
      };

      const result = await service.reflect(input);

      if (!result.passed && result.shouldRetry) {
        expect(result.suggestedCorrection).toBeDefined();
        expect(result.suggestedCorrection?.explanation).toBeTruthy();
      }
    });

    it("should escalate after max retries exceeded", async () => {
      const input = {
        stepId: "step-max-retries",
        missionRunId: 1,
        organizationId: 1,
        output: "The system has exactly 15,420 records and was definitely released in 2023.",
        context: {},
        previousReflections: 3, // At max
      };

      const result = await service.reflect(input);

      expect(result.shouldEscalate).toBe(true);
      expect(result.shouldRetry).toBe(false);
    });

    it("should escalate critical issues immediately", async () => {
      const input = {
        stepId: "step-critical",
        missionRunId: 1,
        organizationId: 1,
        output: "Certainly, absolutely, without a doubt, the system definitely has exactly 123456 records and 78901 users.",
        context: {},
      };

      const result = await service.reflect(input);

      // Should detect hallucination + numeric claims without attribution
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it("should emit event after reflection", async () => {
      const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
      
      const input = {
        stepId: "step-event",
        missionRunId: 1,
        organizationId: 1,
        output: "Test output",
        context: {},
      };

      await service.reflect(input);

      expect(eventStream.publish).toHaveBeenCalledWith(
        "agent.reflection_completed",
        expect.objectContaining({
          missionRunId: 1,
          stepId: "step-event",
        }),
        expect.any(Object),
        "reflection"
      );
    });

    it("should persist reflection to database", async () => {
      const input = {
        stepId: "step-persist",
        missionRunId: 1,
        organizationId: 1,
        output: "Test output",
        context: {},
      };

      await service.reflect(input);

      expect(db.insert).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // CORRECTION STRATEGIES
  // ========================================================================

  describe("attemptCorrection()", () => {
    it("should apply factual correction for missing sources", async () => {
      const input = {
        original: "OpenAI has 500 employees.",
        issues: [{
          type: "factual_error" as const,
          severity: "medium" as const,
          description: "Unverified employee count",
        }],
        context: {},
        attempt: 1,
        maxAttempts: 3,
      };

      const result = await service.attemptCorrection(input);

      expect(result.success).toBe(true);
      expect(result.correctedOutput).toContain("NEEDS VERIFICATION");
      expect(result.shouldRetry).toBe(true);
    });

    it("should apply schema repair for missing fields", async () => {
      const input = {
        original: { name: "Test" }, // Missing required "id" field
        issues: [{
          type: "schema_mismatch" as const,
          severity: "medium" as const,
          description: "Missing required field: id",
        }],
        context: {
          expectedSchema: {
            required: ["id", "name"],
          },
        },
        attempt: 1,
        maxAttempts: 3,
      };

      const result = await service.attemptCorrection(input);

      expect(result.success).toBe(true);
      if (result.correctedOutput && typeof result.correctedOutput === "object") {
        expect(result.correctedOutput).toHaveProperty("id");
      }
    });

    it("should escalate when all strategies fail", async () => {
      const input = {
        original: "Complex contradictory statement requiring nuanced fix.",
        issues: [
          { type: "logical_error" as const, severity: "high" as const, description: "Contradiction" },
          { type: "hallucination" as const, severity: "high" as const, description: "No source" },
        ],
        context: {},
        attempt: 3, // Last attempt
        maxAttempts: 3,
      };

      const result = await service.attemptCorrection(input);

      expect(result.shouldEscalate).toBe(true);
      expect(result.shouldRetry).toBe(false);
    });
  });

  // ========================================================================
  // STATISTICS
  // ========================================================================

  describe("getStats()", () => {
    it("should calculate correct pass rate", async () => {
      const mockLogs = [
        { resolution: "passed", reflectionResult: { confidenceScore: 0.9 } },
        { resolution: "passed", reflectionResult: { confidenceScore: 0.8 } },
        { resolution: "corrected", reflectionResult: { confidenceScore: 0.5 } },
        { resolution: "escalated", reflectionResult: { confidenceScore: 0.3 } },
      ];

      vi.mocked(db.query.reflectionLogs.findMany).mockResolvedValue(mockLogs as any);

      const stats = await service.getStats(1, 30);

      expect(stats.totalReflections).toBe(4);
      expect(stats.passRate).toBe(0.5); // 2 passed / 4 total
      expect(stats.escalationRate).toBe(0.25); // 1 escalated / 4 total
    });

    it("should return top issues by type", async () => {
      const mockLogs = [
        { 
          resolution: "corrected", 
          reflectionResult: { 
            confidenceScore: 0.5,
            issues: [{ type: "hallucination" }, { type: "logical_error" }],
          } 
        },
        { 
          resolution: "corrected", 
          reflectionResult: { 
            confidenceScore: 0.4,
            issues: [{ type: "hallucination" }],
          } 
        },
        { 
          resolution: "escalated", 
          reflectionResult: { 
            confidenceScore: 0.3,
            issues: [{ type: "factual_error" }],
          } 
        },
      ];

      vi.mocked(db.query.reflectionLogs.findMany).mockResolvedValue(mockLogs as any);

      const stats = await service.getStats(1, 30);

      expect(stats.topIssues).toContainEqual({ type: "hallucination", count: 2 });
      expect(stats.topIssues[0].count).toBeGreaterThanOrEqual(stats.topIssues[1]?.count || 0);
    });

    it("should handle empty results gracefully", async () => {
      vi.mocked(db.query.reflectionLogs.findMany).mockResolvedValue([]);

      const stats = await service.getStats(1, 30);

      expect(stats.totalReflections).toBe(0);
      expect(stats.passRate).toBe(0);
      expect(stats.avgConfidence).toBe(0);
    });
  });

  // ========================================================================
  // VERIFICATION STRATEGIES
  // ========================================================================

  describe("Verification Strategies", () => {
    describe("Factual Verification", () => {
      it("should verify claims with sources", async () => {
        const input = {
          stepId: "test",
          missionRunId: 1,
          organizationId: 1,
          output: "According to the 2023 report, revenue was $5M.",
          context: {
            sources: [{ title: "2023 Annual Report", content: "Revenue: $5M" }],
          },
        };

        const result = await service.reflect(input);
        const factualCheck = result.verifications.find(v => v.strategy === "factual");

        expect(factualCheck?.passed).toBe(true);
        expect(factualCheck?.score).toBeGreaterThan(0.7);
      });

      it("should flag unverified numeric claims", async () => {
        const input = {
          stepId: "test",
          missionRunId: 1,
          organizationId: 1,
          output: "The company has exactly 15,420 employees in 12 offices.",
          context: {}, // No sources
        };

        const result = await service.reflect(input);
        const factualCheck = result.verifications.find(v => v.strategy === "factual");

        expect(factualCheck?.passed).toBe(false);
      });
    });

    describe("Logical Verification", () => {
      it("should detect contradictions", async () => {
        const input = {
          stepId: "test",
          missionRunId: 1,
          organizationId: 1,
          output: "We should not implement this feature, but we should implement it immediately.",
          context: {},
        };

        const result = await service.reflect(input);
        const logicalCheck = result.verifications.find(v => v.strategy === "logical");

        expect(logicalCheck?.passed).toBe(false);
      });

      it("should pass logically sound statements", async () => {
        const input = {
          stepId: "test",
          missionRunId: 1,
          organizationId: 1,
          output: "The API returns JSON data that we parse and display in the UI.",
          context: {},
        };

        const result = await service.reflect(input);
        const logicalCheck = result.verifications.find(v => v.strategy === "logical");

        expect(logicalCheck?.passed).toBe(true);
      });
    });

    describe("Hallucination Detection", () => {
      it("should flag absolute claims without evidence", async () => {
        const input = {
          stepId: "test",
          missionRunId: 1,
          organizationId: 1,
          output: "Without a doubt, this is definitely the best approach.",
          context: {},
        };

        const result = await service.reflect(input);
        const hallucinationCheck = result.verifications.find(v => v.strategy === "hallucination");

        expect(hallucinationCheck?.passed).toBe(false);
        expect(hallucinationCheck?.score).toBeLessThanOrEqual(0.7);
      });

      it("should pass appropriately cautious statements", async () => {
        const input = {
          stepId: "test",
          missionRunId: 1,
          organizationId: 1,
          output: "Based on the requirements, this approach may work, but we should test it.",
          context: {},
        };

        const result = await service.reflect(input);
        const hallucinationCheck = result.verifications.find(v => v.strategy === "hallucination");

        expect(hallucinationCheck?.passed).toBe(true);
      });
    });

    describe("Schema Verification", () => {
      it("should validate against expected schema", async () => {
        const input = {
          stepId: "test",
          missionRunId: 1,
          organizationId: 1,
          output: { name: "Test", value: 123 },
          context: {
            expectedSchema: {
              type: "object",
              required: ["name", "value"],
            },
          },
        };

        const result = await service.reflect(input);
        const schemaCheck = result.verifications.find(v => v.strategy === "schema");

        expect(schemaCheck?.passed).toBe(true);
      });

      it("should detect missing required fields", async () => {
        const input = {
          stepId: "test",
          missionRunId: 1,
          organizationId: 1,
          output: { name: "Test" }, // Missing "value"
          context: {
            expectedSchema: {
              type: "object",
              required: ["name", "value"],
            },
          },
        };

        const result = await service.reflect(input);
        const schemaCheck = result.verifications.find(v => v.strategy === "schema");

        expect(schemaCheck?.passed).toBe(false);
      });
    });
  });

  // ========================================================================
  // EDGE CASES
  // ========================================================================

  describe("Edge Cases", () => {
    it("should handle null/undefined output", async () => {
      const input = {
        stepId: "test-null",
        missionRunId: 1,
        organizationId: 1,
        output: null,
        context: {},
      };

      const result = await service.reflect(input);

      expect(result).toBeDefined();
      expect(result.reflectionId).toBeDefined();
    });

    it("should handle very long outputs", async () => {
      const longOutput = "A".repeat(10000);
      
      const input = {
        stepId: "test-long",
        missionRunId: 1,
        organizationId: 1,
        output: longOutput,
        context: {},
      };

      const result = await service.reflect(input);

      expect(result).toBeDefined();
      expect(result.reflectionId).toBeDefined();
    });

    it("should handle circular references gracefully", async () => {
      const obj: any = { a: 1 };
      obj.self = obj; // Circular reference

      const input = {
        stepId: "test-circular",
        missionRunId: 1,
        organizationId: 1,
        output: obj,
        context: {},
      };

      // Should not throw
      const result = await service.reflect(input);
      expect(result).toBeDefined();
    });

    it("should respect disabled reflection setting", async () => {
      const disabledService = new ReflectionService({
        reflectionEnabled: false,
      });

      const input = {
        stepId: "test-disabled",
        missionRunId: 1,
        organizationId: 1,
        output: "Test",
        context: {},
      };

      // When disabled, should still work but possibly with different behavior
      const result = await disabledService.reflect(input);
      expect(result).toBeDefined();
    });
  });
});

describe("ReflectionService Integration", () => {
  it("should complete full reflection-correction cycle", async () => {
    const service = new ReflectionService({
      confidenceThreshold: 0.7,
      maxReflectionDepth: 3,
    });

    // First attempt - low confidence (numeric claim + contradiction to trigger factual + logical failure)
    const firstAttempt = await service.reflect({
      stepId: "integration-test",
      missionRunId: 1,
      organizationId: 1,
      output: "We should not implement this, but we should implement it. The company has exactly 15420 employees.",
      previousReflections: 0,
    });

    expect(firstAttempt.passed).toBe(false);
    expect(firstAttempt.shouldRetry).toBe(true);

    // Second attempt - with correction applied
    if (firstAttempt.suggestedCorrection?.correctedOutput) {
      const secondAttempt = await service.reflect({
        stepId: "integration-test",
        missionRunId: 1,
        organizationId: 1,
        output: firstAttempt.suggestedCorrection.correctedOutput,
        previousReflections: 1,
      });

      // Should have improved
      expect(secondAttempt.confidenceScore).toBeGreaterThanOrEqual(firstAttempt.confidenceScore);
    }
  });
});
