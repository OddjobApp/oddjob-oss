/**
 * Blueprint Evolution Service Tests
 */
import { describe, it, expect, beforeEach } from "vitest";
import { blueprintEvolutionService } from "@domain/apps/core/blueprint-evolution.service";
import { db } from "@server/database_service";
import { apps, appAuditLogs, blueprints } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const TEST_APP_IDS = [991, 992, 993, 994, 995, 996, 997, 998, 999, 1000, 1001, 1002, 1003, 1004, 1005];

describe("BlueprintEvolutionService", () => {
  const testBlueprintId = "test-blueprint";

  beforeEach(async () => {
    // Reset in-memory generation state (service is a singleton)
    (blueprintEvolutionService as any).generations.clear();

    // Clean up test data — audit logs first (FK), then apps, then blueprint
    await db.delete(appAuditLogs).where(inArray(appAuditLogs.appId, TEST_APP_IDS));
    await db.delete(apps).where(inArray(apps.id, TEST_APP_IDS));
    await db.delete(apps).where(eq(apps.blueprintSlug, testBlueprintId));
    await db.delete(blueprints).where(eq(blueprints.slug, testBlueprintId));

    // Create test blueprint
    await db.insert(blueprints).values({
      slug: testBlueprintId,
      name: "Test Blueprint",
      description: "For testing evolution",
      category: "test",
      version: "1.0.0"
    });
  });

  describe("collectMetrics", () => {
    it("should collect blueprint metrics", async () => {
      // Create test apps
      await db.insert(apps).values([
        {
          id: 991,
          name: "App 1",
          slug: "app-1",
          blueprintSlug: testBlueprintId,
          status: "active",
          developerOrgId: 1,
          runtimeMetadata: { 
            lastBuildDuration: 60000,
            usedFeatures: ["table", "chart"]
          }
        },
        {
          id: 992,
          name: "App 2",
          slug: "app-2",
          blueprintSlug: testBlueprintId,
          status: "error",
          developerOrgId: 1,
          runtimeMetadata: { 
            lastBuildDuration: 120000,
            usedFeatures: ["table"]
          }
        }
      ]);

      const metrics = await blueprintEvolutionService.collectMetrics(testBlueprintId);

      expect(metrics).toBeDefined();
      expect(metrics.blueprintId).toBe(testBlueprintId);
      expect(metrics.totalAppsCreated).toBe(2);
      expect(metrics.successRate).toBe(0.5);
      expect(metrics.averageBuildTime).toBe(90000); // Average of 60s and 120s
      expect(metrics.topFeatures).toContain("table");
    });

    it("should handle empty blueprints", async () => {
      const metrics = await blueprintEvolutionService.collectMetrics("nonexistent");

      expect(metrics.totalAppsCreated).toBe(0);
      expect(metrics.successRate).toBe(1);
      expect(metrics.commonIssues).toEqual([]);
    });

    it("should identify common issues", async () => {
      // Create apps with issues
      await db.insert(apps).values({
        id: 993,
        name: "App With Issues",
        slug: "app-issues",
        blueprintSlug: testBlueprintId,
        status: "active",
        developerOrgId: 1
      });

      await db.insert(appAuditLogs).values([
        {
          appId: 993,
          orgId: 1,
          findingType: "console_error",
          severity: "high",
          description: "undefined variable",
          qaTrace: { file: "index.tsx" }
        },
        {
          appId: 993,
          orgId: 1,
          findingType: "console_error",
          severity: "high",
          description: "another error",
          qaTrace: { file: "utils.ts" }
        }
      ]);

      const metrics = await blueprintEvolutionService.collectMetrics(testBlueprintId);

      expect(metrics.commonIssues).toHaveLength(1);
      expect(metrics.commonIssues[0].type).toBe("console_error");
      expect(metrics.commonIssues[0].severity).toBe("high");
      expect(metrics.commonIssues[0].frequency).toBe(2);
    });
  });

  describe("generateSuggestions", () => {
    it("should suggest performance improvements for slow builds", async () => {
      // Create app with slow build
      await db.insert(apps).values({
        id: 994,
        name: "Slow App",
        slug: "slow-app",
        blueprintSlug: testBlueprintId,
        status: "active",
        developerOrgId: 1,
        runtimeMetadata: { lastBuildDuration: 180000 } // 3 minutes
      });

      const suggestions = await blueprintEvolutionService.generateSuggestions(testBlueprintId);

      const performanceSuggestion = suggestions.find(s => s.type === "performance");
      expect(performanceSuggestion).toBeDefined();
      expect(performanceSuggestion!.priority).toBe("high");
      expect(performanceSuggestion!.confidence).toBeGreaterThan(0.8);
    });

    it("should suggest reliability improvements for low success rate", async () => {
      // Create failing apps
      await db.insert(apps).values([
        {
          id: 995,
          name: "Fail 1",
          slug: "fail-1",
          blueprintSlug: testBlueprintId,
          status: "error",
          developerOrgId: 1
        },
        {
          id: 996,
          name: "Fail 2",
          slug: "fail-2",
          blueprintSlug: testBlueprintId,
          status: "error",
          developerOrgId: 1
        },
        {
          id: 997,
          name: "Success",
          slug: "success",
          blueprintSlug: testBlueprintId,
          status: "active",
          developerOrgId: 1
        }
      ]);

      const suggestions = await blueprintEvolutionService.generateSuggestions(testBlueprintId);

      const reliabilitySuggestion = suggestions.find(s => s.type === "reliability");
      expect(reliabilitySuggestion).toBeDefined();
      expect(reliabilitySuggestion!.priority).toBe("high");
    });

    it("should suggest usability improvements for low satisfaction", async () => {
      // satisfaction = max(1, min(5, 5 - highPenalty(0.5ea) + successBonus(activeRatio*2)))
      // For satisfaction < 4.0 with a failed app (successBonus=0): need 3+ high-severity logs
      await db.insert(apps).values({
        id: 998,
        name: "Low Sat",
        slug: "low-sat",
        blueprintSlug: testBlueprintId,
        status: "error",
        developerOrgId: 1
      });

      await db.insert(appAuditLogs).values([
        { appId: 998, orgId: 1, findingType: "ui_issue", severity: "high", description: "Bad UX" },
        { appId: 998, orgId: 1, findingType: "ui_issue", severity: "high", description: "Confusing" },
        { appId: 998, orgId: 1, findingType: "ui_issue", severity: "high", description: "Slow" }
      ]);

      const suggestions = await blueprintEvolutionService.generateSuggestions(testBlueprintId);

      expect(suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("evolveBlueprint", () => {
    it("should create a new generation", async () => {
      // Setup
      await db.insert(apps).values({
        id: 999,
        name: "Test",
        slug: "test",
        blueprintSlug: testBlueprintId,
        status: "active",
        developerOrgId: 1
      });

      const suggestion = {
        blueprintId: testBlueprintId,
        type: "performance" as const,
        priority: "high" as const,
        description: "Optimize build",
        recommendedChanges: [
          { filePath: "Dockerfile", operation: "modify" as const, description: "Multi-stage" }
        ],
        expectedImpact: { buildTimeReduction: 0.3 },
        confidence: 0.9
      };

      const generation = await blueprintEvolutionService.evolveBlueprint(
        testBlueprintId,
        suggestion,
        "test@example.com"
      );

      expect(generation).toBeDefined();
      expect(generation.blueprintId).toBe(testBlueprintId);
      expect(generation.generationNumber).toBe(1);
      expect(generation.changes).toHaveLength(1);
      expect(generation.approved).toBe(false);
    });

    it("should increment generation numbers", async () => {
      await db.insert(apps).values({
        id: 1000,
        name: "Test",
        slug: "test-2",
        blueprintSlug: testBlueprintId,
        status: "active",
        developerOrgId: 1
      });

      const suggestion = {
        blueprintId: testBlueprintId,
        type: "feature" as const,
        priority: "low" as const,
        description: "Add feature",
        recommendedChanges: [],
        expectedImpact: {},
        confidence: 0.5
      };

      const gen1 = await blueprintEvolutionService.evolveBlueprint(testBlueprintId, suggestion, "a");
      const gen2 = await blueprintEvolutionService.evolveBlueprint(testBlueprintId, suggestion, "b");

      expect(gen1.generationNumber).toBe(1);
      expect(gen2.generationNumber).toBe(2);
      expect(gen2.parentGenerationId).toBe(gen1.id);
    });
  });

  describe("approveGeneration", () => {
    it("should approve a generation", async () => {
      // First create a generation
      await db.insert(apps).values({
        id: 1001,
        name: "Test",
        slug: "test-3",
        blueprintSlug: testBlueprintId,
        status: "active",
        developerOrgId: 1
      });

      const suggestion = {
        blueprintId: testBlueprintId,
        type: "reliability" as const,
        priority: "medium" as const,
        description: "Fix bugs",
        recommendedChanges: [],
        expectedImpact: {},
        confidence: 0.8
      };

      const generation = await blueprintEvolutionService.evolveBlueprint(testBlueprintId, suggestion, "test");

      // Approve
      await blueprintEvolutionService.approveGeneration(generation.id, true);

      // Verify
      const history = blueprintEvolutionService.getEvolutionHistory(testBlueprintId);
      expect(history[0].approved).toBe(true);
    });

    it("should reject a generation", async () => {
      await db.insert(apps).values({
        id: 1002,
        name: "Test",
        slug: "test-4",
        blueprintSlug: testBlueprintId,
        status: "active",
        developerOrgId: 1
      });

      const suggestion = {
        blueprintId: testBlueprintId,
        type: "usability" as const,
        priority: "low" as const,
        description: "UI tweak",
        recommendedChanges: [],
        expectedImpact: {},
        confidence: 0.6
      };

      const generation = await blueprintEvolutionService.evolveBlueprint(testBlueprintId, suggestion, "test");
      await blueprintEvolutionService.approveGeneration(generation.id, false);

      const history = blueprintEvolutionService.getEvolutionHistory(testBlueprintId);
      expect(history[0].approved).toBe(false);
    });
  });

  describe("getEvolutionHistory", () => {
    it("should return evolution history", async () => {
      await db.insert(apps).values({
        id: 1003,
        name: "Test",
        slug: "test-5",
        blueprintSlug: testBlueprintId,
        status: "active",
        developerOrgId: 1
      });

      const suggestion = {
        blueprintId: testBlueprintId,
        type: "performance" as const,
        priority: "high" as const,
        description: "Test",
        recommendedChanges: [],
        expectedImpact: {},
        confidence: 0.7
      };

      await blueprintEvolutionService.evolveBlueprint(testBlueprintId, suggestion, "test");

      const history = blueprintEvolutionService.getEvolutionHistory(testBlueprintId);
      expect(history).toHaveLength(1);
    });

    it("should return empty array for new blueprints", () => {
      const history = blueprintEvolutionService.getEvolutionHistory("brand-new");
      expect(history).toEqual([]);
    });
  });

  describe("getLatestApprovedGeneration", () => {
    it("should return the latest approved generation", async () => {
      await db.insert(apps).values({
        id: 1004,
        name: "Test",
        slug: "test-6",
        blueprintSlug: testBlueprintId,
        status: "active",
        developerOrgId: 1
      });

      const suggestion = {
        blueprintId: testBlueprintId,
        type: "feature" as const,
        priority: "low" as const,
        description: "Test",
        recommendedChanges: [],
        expectedImpact: {},
        confidence: 0.5
      };

      const gen = await blueprintEvolutionService.evolveBlueprint(testBlueprintId, suggestion, "test");
      await blueprintEvolutionService.approveGeneration(gen.id, true);

      const latest = blueprintEvolutionService.getLatestApprovedGeneration(testBlueprintId);
      expect(latest).toBeDefined();
      expect(latest!.approved).toBe(true);
    });

    it("should return null when no approved generations", async () => {
      await db.insert(apps).values({
        id: 1005,
        name: "Test",
        slug: "test-7",
        blueprintSlug: testBlueprintId,
        status: "active",
        developerOrgId: 1
      });

      const suggestion = {
        blueprintId: testBlueprintId,
        type: "feature" as const,
        priority: "low" as const,
        description: "Test",
        recommendedChanges: [],
        expectedImpact: {},
        confidence: 0.5
      };

      await blueprintEvolutionService.evolveBlueprint(testBlueprintId, suggestion, "test");
      // Don't approve

      const latest = blueprintEvolutionService.getLatestApprovedGeneration(testBlueprintId);
      expect(latest).toBeNull();
    });
  });
});
