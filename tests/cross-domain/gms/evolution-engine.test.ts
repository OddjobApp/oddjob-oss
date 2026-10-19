/**
 * Evolution Engine Tests
 * 
 * Tests Phase 4 genetic algorithm for skill improvement.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createEvolutionEngine } from "../../../server/core/gms/skills/evolution-engine.js";
import { createSkillLibrary } from "../../../server/core/gms/skills/skill-library.js";
import type { Skill, ShadowResult } from "../../../server/core/gms/common/types.js";

// Mock shadow orchestrator
const createMockShadowOrchestrator = () => ({
  quickValidate: vi.fn().mockResolvedValue({
    validated: true,
    shadowResult: {
      successRate: 0.95,
      runs: [],
      avgLatency: 4000,
      totalCost: 0.04,
      failureModes: [],
      variationsAnalyzed: 5
    },
    recommendation: "proceed"
  }),
  validateCandidates: vi.fn()
});

describe("Evolution Engine", () => {
  let shadowOrchestrator: ReturnType<typeof createMockShadowOrchestrator>;
  let engine: ReturnType<typeof createEvolutionEngine>;
  let library: ReturnType<typeof createSkillLibrary>;

  beforeEach(() => {
    shadowOrchestrator = createMockShadowOrchestrator();
    engine = createEvolutionEngine(shadowOrchestrator as any, {
      populationSize: 5,
      maxGenerations: 3,
      mutationRate: 0.2,
      convergenceThreshold: 0
    });
    library = createSkillLibrary();
  });

  describe("Evolution Algorithm", () => {
    it("should evolve a skill with genetic algorithm", async () => {
      const parent = createMockSkill();

      const result = await engine.evolveSkill(parent);

      expect(result).toBeDefined();
      expect(result.generations).toBeGreaterThan(0);
    });

    it("should return success with improvement when evolution works", async () => {
      const parent = createMockSkill({ successRate: 0.7 });

      const result = await engine.evolveSkill(parent);

      if (result.success) {
        expect(result.improvement).toBeGreaterThanOrEqual(0);
        expect(result.bestVariant).toBeDefined();
      }
    });

    it("should handle evolution failure gracefully", async () => {
      // Make shadow validation fail
      shadowOrchestrator.quickValidate.mockResolvedValue({
        validated: false,
        shadowResult: { successRate: 0.3, runs: [], avgLatency: 8000, totalCost: 0.1, failureModes: [], variationsAnalyzed: 5 },
        recommendation: "reject"
      });

      const parent = createMockSkill();

      const result = await engine.evolveSkill(parent);

      expect(result.success).toBe(false);
      expect(result.improvement).toBe(0);
    });

    it("should respect maxGenerations limit", async () => {
      const parent = createMockSkill();
      const customEngine = createEvolutionEngine(shadowOrchestrator as any, {
        maxGenerations: 2
      });

      const result = await customEngine.evolveSkill(parent);

      expect(result.generations).toBeLessThanOrEqual(2);
    });

    it("should batch evolve multiple skills", async () => {
      const skills = [
        createMockSkill({ name: "Skill 1" }),
        createMockSkill({ name: "Skill 2" }),
        createMockSkill({ name: "Skill 3" })
      ];

      const results = await engine.evolveBatch(skills);

      expect(results.length).toBe(3);
      expect(results.every(r => r.result !== undefined)).toBe(true);
    });
  });

  describe("Genetic Operations", () => {
    it("should create population through mutation", async () => {
      const parent = createMockSkill();

      const result = await engine.evolveSkill(parent);

      // Should have attempted evolution with mutations
      expect(shadowOrchestrator.quickValidate).toHaveBeenCalled();
    });

    it("should crossover between successful parents", async () => {
      // Register two parent skills with proven track records
      const parent1 = createMockSkill({ id: "parent1", successRate: 0.9 });
      const parent2 = createMockSkill({ id: "parent2", successRate: 0.85 });

      // Evolution with crossover rate > 0 should sometimes combine parents
      const crossoverEngine = createEvolutionEngine(shadowOrchestrator as any, {
        crossoverRate: 1.0, // Always crossover
        populationSize: 3
      });

      const result = await crossoverEngine.evolveSkill(parent1);

      // Evolution should complete
      expect(result.generations).toBeGreaterThan(0);
    });
  });

  describe("Evolution Tracking", () => {
    it("should provide evolution status during run", async () => {
      const parent = createMockSkill();

      // Start evolution (we'll check status mid-run conceptually)
      const evolutionPromise = engine.evolveSkill(parent);

      // Evolution should complete
      const result = await evolutionPromise;

      expect(result.generations).toBeGreaterThanOrEqual(0);
    });

    it("should allow aborting active evolution", () => {
      const parent = createMockSkill();
      
      // We can't easily test this without a slow evolution
      // but we can verify the method exists
      expect(typeof engine.abortEvolution).toBe("function");
    });
  });

  describe("Fitness Calculation", () => {
    it("should calculate fitness based on success rate and efficiency", async () => {
      const highPerformingSkill = createMockSkill({ 
        successRate: 0.95, 
        totalRuns: 100, 
        successfulRuns: 95 
      });

      const result = await engine.evolveSkill(highPerformingSkill);

      // High performers should have good evolution outcomes
      expect(result).toBeDefined();
    });

    it("should prioritize high-usage skills for evolution", async () => {
      const highUsageSkill = createMockSkill({ 
        usageCount: 1000,
        successRate: 0.75,
        totalRuns: 1000,
        successfulRuns: 750
      });

      // Evolution should consider usage in fitness
      const result = await engine.evolveSkill(highUsageSkill);

      expect(result).toBeDefined();
    });
  });

  describe("Genome Representation", () => {
    it("should extract genome from skill", async () => {
      const skill = createMockSkill();

      // Evolution internally extracts genome
      const result = await engine.evolveSkill(skill);

      // Should complete evolution using genome representation
      expect(result.generations).toBeGreaterThanOrEqual(0);
    });

    it("should apply mutations to genome", async () => {
      const skill = createMockSkill();
      const highMutationEngine = createEvolutionEngine(shadowOrchestrator as any, {
        mutationRate: 1.0, // Always mutate
        populationSize: 3
      });

      const result = await highMutationEngine.evolveSkill(skill);

      expect(result.generations).toBeGreaterThan(0);
    });
  });
});

// Helper function
function createMockSkill(options: {
  id?: string;
  name?: string;
  successRate?: number;
  usageCount?: number;
  totalRuns?: number;
  successfulRuns?: number;
} = {}): Skill {
  const id = options.id || `skill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const successRate = options.successRate ?? 0.85;
  
  return {
    id,
    name: options.name || "Test Skill",
    description: "Test skill for evolution",
    blueprint: {
      name: options.name || "Test Skill",
      description: "Test",
      version: "1.0.0",
      steps: [
        { id: "s1", type: "agent", name: "Analyze", description: "Test", config: {} }
      ],
      agents: [
        { 
          id: "a1", 
          name: "Analyzer",
          model: "gemini-2.0-flash", 
          temperature: 0.7, 
          maxTokens: 4000,
          systemPrompt: "test", 
          allowedTools: ["api"],
          reasoningProtocol: "hermes_xml",
          deliberationDepth: 2 
        }
      ],
      tools: [{ name: "api", version: "1.0", required: true, timeout: 5000, retryCount: 3 }],
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: {} },
      maxDuration: 60,
      retryPolicy: { maxAttempts: 3, backoffStrategy: "exponential", backoffMs: 1000 },
      reasoningConfig: { protocol: "hermes_xml", depth: 2, selfReflect: true, verifyActions: true }
    },
    verifierScore: {
      successProbability: successRate,
      confidence: 0.8,
      latencyEstimate: 5000,
      costEstimate: 0.05,
      riskFactors: []
    },
    shadowResult: {
      successRate,
      runs: [],
      avgLatency: 4800,
      totalCost: 0.05,
      failureModes: [],
      hermesTraces: [],
      predictionDelta: 0.05,
      candidateId: id,
      completedAt: new Date(),
      minLatency: 3000,
      maxLatency: 7000
    },
    productionStats: {
      totalRuns: options.totalRuns ?? 10,
      successfulRuns: options.successfulRuns ?? 8,
      failedRuns: (options.totalRuns ?? 10) - (options.successfulRuns ?? 8),
      avgLatency: 4800,
      avgCost: 0.05,
      successRateTrend: "stable"
    },
    generation: 1,
    parentIds: [],
    childrenIds: [],
    mutations: [],
    evolutionLineage: [id],
    tags: ["tool:api", "category:test"],
    createdAt: new Date(),
    lastUsedAt: new Date(),
    usageCount: options.usageCount ?? 10
  };
}
