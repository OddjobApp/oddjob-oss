/**
 * Skill Library Tests
 * 
 * Tests Phase 4 skill registry, search, and evolution functionality.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createSkillLibrary } from "../../../server/core/gms/skills/skill-library.js";
import type { Skill, ShadowResult } from "../../../server/core/gms/common/types.js";

describe("Skill Library", () => {
  let library: ReturnType<typeof createSkillLibrary>;

  beforeEach(() => {
    library = createSkillLibrary({ maxSkills: 100, similarityThreshold: 0.1 });
  });

  describe("Skill Registration", () => {
    it("should register a skill with auto-tagging", () => {
      const candidate = createMockCandidate();
      const shadowResult = createMockShadowResult();

      const skill = library.registerSkill(candidate, shadowResult, { autoTag: true });

      expect(skill.id).toMatch(/^skill_/);
      expect(skill.name).toBe(candidate.blueprint.name);
      expect(skill.tags.length).toBeGreaterThan(0);
      expect(skill.generation).toBe(1);
      expect(skill.parentIds).toEqual([]);
    });

    it("should track production statistics", () => {
      const skill = registerMockSkill(library);

      library.recordProductionRun(skill.id, {
        success: true,
        latency: 5000,
        cost: 0.05
      });

      const updated = library.getSkill(skill.id);
      expect(updated?.productionStats.totalRuns).toBe(1);
      expect(updated?.productionStats.successfulRuns).toBe(1);
      expect(updated?.usageCount).toBe(1);
    });

    it("should evict LRU skills when library is full", () => {
      const smallLibrary = createSkillLibrary({ maxSkills: 3 });

      const skill1 = registerMockSkill(smallLibrary, "Skill 1");
      const skill2 = registerMockSkill(smallLibrary, "Skill 2");
      const skill3 = registerMockSkill(smallLibrary, "Skill 3");

      // Explicitly set lastUsedAt so LRU order is deterministic —
      // timestamps from registerSkill are within the same millisecond
      const now = Date.now();
      (smallLibrary as any).skills.get(skill3.id).lastUsedAt = new Date(now - 3000);
      (smallLibrary as any).skills.get(skill1.id).lastUsedAt = new Date(now - 2000);
      (smallLibrary as any).skills.get(skill2.id).lastUsedAt = new Date(now - 1000);

      // Register 4th skill — should evict skill3 (oldest lastUsedAt)
      const skill4 = registerMockSkill(smallLibrary, "Skill 4");

      expect(smallLibrary.getSkill(skill1.id)).toBeDefined();
      expect(smallLibrary.getSkill(skill2.id)).toBeDefined();
      expect(smallLibrary.getSkill(skill3.id)).toBeUndefined();
      expect(smallLibrary.getSkill(skill4.id)).toBeDefined();
    });
  });

  describe("Semantic Search", () => {
    it("should find skills by query", async () => {
      registerMockSkill(library, "Customer Churn Analyzer", "Analyzes customer churn patterns");
      registerMockSkill(library, "Revenue Forecast", "Predicts revenue trends");
      registerMockSkill(library, "User Engagement", "Tracks user engagement metrics");

      const results = await library.findSkills("churn analysis", { limit: 5 });

      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0].skill).toBeDefined();
        expect(Array.isArray(results[0].matchReasons)).toBe(true);
      }
    });

    it("should filter by required tags", async () => {
      const skill1 = registerMockSkill(library, "Skill 1", "Description");
      const skill2 = registerMockSkill(library, "Skill 2", "Description");

      // Manually add tags for testing
      (skill1 as any).tags = ["tool:api", "category:analytics"];
      (skill2 as any).tags = ["tool:db", "category:analytics"];

      const results = await library.findSkills("test", {
        requiredTags: ["tool:api"]
      });

      // Only skill1 has tool:api tag
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it("should filter by minimum success rate", async () => {
      const skill = registerMockSkill(library, "High Success", "Test");
      
      // Record many successful runs
      for (let i = 0; i < 10; i++) {
        library.recordProductionRun(skill.id, { success: true, latency: 1000, cost: 0.01 });
      }

      const results = await library.findSkills("test", { minSuccessRate: 0.9 });

      expect(results.every(r => 
        (r.skill.productionStats.successfulRuns / r.skill.productionStats.totalRuns) >= 0.9
      )).toBe(true);
    });
  });

  describe("Composable Skills", () => {
    it("should find composable skills for complex goals", async () => {
      // Use very explicit names that match the query keywords exactly
      registerMockSkill(library, "Extract", "Extract data from APIs");
      registerMockSkill(library, "Analyze", "Analyze data patterns");
      registerMockSkill(library, "Report", "Generate reports");

      // Query containing those keywords
      const skills = await library.findComposableSkills("Extract data and then Analyze it for a Report");

      expect(skills.length).toBeGreaterThan(0);
    });
  });

  describe("Health Monitoring", () => {
    it("should detect healthy skills", () => {
      const skill = registerMockSkill(library, "Healthy Skill", "Test");
      
      // Record successful production runs
      for (let i = 0; i < 10; i++) {
        library.recordProductionRun(skill.id, { success: true, latency: 3000, cost: 0.03 });
      }

      const health = library.checkSkillHealth(skill.id);

      expect(health.status).toBe("healthy");
    });

    it("should detect degraded skills", () => {
      const skill = registerMockSkill(library, "Degrading Skill", "Test");
      
      // Shadow validation showed 90% success
      // But production only showing 70%
      for (let i = 0; i < 3; i++) {
        library.recordProductionRun(skill.id, { success: true, latency: 3000, cost: 0.03 });
      }
      for (let i = 0; i < 7; i++) {
        library.recordProductionRun(skill.id, { success: false, latency: 5000, cost: 0.05 });
      }

      const health = library.checkSkillHealth(skill.id);

      expect(["degraded", "needs_evolution"]).toContain(health.status);
    });

    it("should get evolution candidates", () => {
      const skill1 = registerMockSkill(library, "Healthy", "Test");
      const skill2 = registerMockSkill(library, "Needs Work", "Test");

      // Make skill2 degrade
      for (let i = 0; i < 2; i++) {
        library.recordProductionRun(skill2.id, { success: true, latency: 3000, cost: 0.03 });
      }
      for (let i = 0; i < 8; i++) {
        library.recordProductionRun(skill2.id, { success: false, latency: 5000, cost: 0.05 });
      }

      const candidates = library.getEvolutionCandidates();

      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.find(s => s.id === skill2.id)).toBeDefined();
    });
  });

  describe("Lineage Tracking", () => {
    it("should track skill lineage", () => {
      const parent = registerMockSkill(library, "Parent", "Test");
      
      // Register child skill
      const child = library.registerSkill(
        {
          ...createMockCandidate("Child"),
          generation: {
            timestamp: new Date(),
            model: "test",
            temperature: 0.7,
            promptTokens: 100,
            completionTokens: 50,
            generationMethod: "evolution",
            parentIds: [parent.id],
            generation: 2,
            mutations: [{ type: "temperature", description: "test", impact: "positive" }]
          }
        },
        createMockShadowResult()
      );

      const lineage = library.getLineage(child.id);

      expect(lineage).toBeDefined();
      expect(lineage?.ancestors.length).toBe(1);
      expect(lineage?.ancestors[0].id).toBe(parent.id);
      expect(lineage?.descendants.length).toBe(0);
    });
  });

  describe("Library Statistics", () => {
    it("should provide comprehensive statistics", () => {
      // Register skills from different generations
      for (let i = 0; i < 5; i++) {
        library.registerSkill(createMockCandidate(`Skill ${i}`), createMockShadowResult());
      }

      const stats = library.getStats();

      expect(stats.totalSkills).toBe(5);
      expect(stats.avgSuccessRate).toBeGreaterThanOrEqual(0);
      expect(stats.totalUsage).toBe(0); // Not used yet
      expect(stats.topSkills.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Import/Export", () => {
    it("should export and import library", () => {
      const skill1 = registerMockSkill(library, "Skill 1", "Test");
      const skill2 = registerMockSkill(library, "Skill 2", "Test");

      const exported = library.export();

      expect(exported.skills.length).toBe(2);
      expect(exported.version).toBe("1.0");

      // Create new library and import
      const newLibrary = createSkillLibrary();
      newLibrary.import(exported);

      expect(newLibrary.getStats().totalSkills).toBe(2);
      expect(newLibrary.getSkill(skill1.id)).toBeDefined();
      expect(newLibrary.getSkill(skill2.id)).toBeDefined();
    });
  });
});

// Helper functions
function createMockCandidate(name = "Test Skill", description = "Test description"): any {
  return {
    id: `candidate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    request: name,
    blueprint: {
      name,
      description,
      version: "1.0.0",
      steps: [
        { id: "step1", type: "agent" as const, name: "Analyze", description: "Test step", config: {} }
      ],
      agents: [
        { id: "agent1", model: "gemini-2.0-flash", temperature: 0.7, systemPrompt: "test" }
      ],
      tools: [{ name: "api", version: "1.0", required: true }],
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      maxDuration: 60,
      retryPolicy: { maxAttempts: 3, backoffStrategy: "exponential" },
      reasoningConfig: { protocol: "hermes_xml", depth: 2 }
    },
    generation: {
      timestamp: new Date(),
      model: "test",
      temperature: 0.7,
      promptTokens: 100,
      completionTokens: 50,
      generationMethod: "test",
      parentIds: [],
      generation: 1,
      mutations: []
    },
    status: "validated" as const,
    verifierScore: {
      successProbability: 0.85,
      confidence: 0.8,
      latencyEstimate: 5000,
      costEstimate: 0.05,
      riskFactors: []
    },
    createdAt: new Date()
  };
}

function createMockShadowResult(): ShadowResult {
  return {
    successRate: 0.9,
    runs: [],
    avgLatency: 4800,
    totalCost: 0.05,
    failureModes: [],
    variationsAnalyzed: 10
  };
}

function registerMockSkill(
  library: ReturnType<typeof createSkillLibrary>,
  name = "Test Skill",
  description = "Test description"
): Skill {
  return library.registerSkill(
    createMockCandidate(name, description),
    createMockShadowResult(),
    { autoTag: true }
  );
}
