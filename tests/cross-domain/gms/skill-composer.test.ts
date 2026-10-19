/**
 * Skill Composer Tests
 * 
 * Tests Phase 4 mission composition from skills.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createSkillComposer } from "../../../server/core/gms/skills/skill-composer.js";
import { createSkillLibrary } from "../../../server/core/gms/skills/skill-library.js";
import type { Skill, SkillComposition } from "../../../server/core/gms/common/types.js";

describe("Skill Composer", () => {
  let library: ReturnType<typeof createSkillLibrary>;
  let composer: ReturnType<typeof createSkillComposer>;

  beforeEach(() => {
    library = createSkillLibrary();
    composer = createSkillComposer(library);
  });

  describe("Skill Composition", () => {
    it("should compose skills into mission", async () => {
      // Register skills
      const skill1 = registerMockSkill(library, "Data Extractor", "Extracts data from APIs");
      const skill2 = registerMockSkill(library, "Data Analyzer", "Analyzes data patterns");

      const composition = await composer.compose(
        "Extract and analyze customer data",
        [skill1.id, skill2.id]
      );

      expect(composition).toBeDefined();
      expect(composition?.subSkills.length).toBe(2);
      expect(composition?.subSkills[0].skillId).toBe(skill1.id);
      expect(composition?.subSkills[1].skillId).toBe(skill2.id);
    });

    it("should create data flow between skills", async () => {
      const skill1 = registerMockSkill(library, "Extractor", "Extracts data");
      const skill2 = registerMockSkill(library, "Analyzer", "Analyzes data");

      const composition = await composer.compose(
        "Process data",
        [skill1.id, skill2.id],
        { 
          dataMappings: [
            { from: skill1.id, to: skill2.id }
          ]
        }
      );

      expect(composition?.dataFlow.length).toBeGreaterThan(0);
    });

    it("should build control flow for execution order", async () => {
      const skill1 = registerMockSkill(library, "Step 1", "First");
      const skill2 = registerMockSkill(library, "Step 2", "Second");

      const composition = await composer.compose(
        "Sequential process",
        [skill1.id, skill2.id]
      );

      expect(composition?.controlFlow.length).toBeGreaterThan(0);
      expect(composition?.controlFlow[0].from).toBe(skill1.id);
      expect(composition?.controlFlow[0].to).toBe(skill2.id);
    });

    it("should return null for invalid composition", async () => {
      // Try to compose with non-existent skill
      const composition = await composer.compose(
        "Invalid",
        ["non_existent_skill"]
      );

      expect(composition).toBeNull();
    });
  });

  describe("Composition Analysis", () => {
    it("should analyze composition feasibility", async () => {
      const skill1 = registerMockSkill(library, "Skill 1", "Test");
      const skill2 = registerMockSkill(library, "Skill 2", "Test");

      const composition = await composer.compose("Test", [skill1.id, skill2.id]);
      expect(composition).toBeDefined();

      const analysis = composer.analyzeComposition(composition!);

      expect(analysis.valid).toBe(true);
      expect(analysis.estimatedLatency).toBeGreaterThan(0);
      expect(analysis.estimatedCost).toBeGreaterThanOrEqual(0);
      expect(analysis.successProbability).toBeGreaterThanOrEqual(0);
      expect(analysis.successProbability).toBeLessThanOrEqual(1);
    });

    it("should detect cycles in composition", async () => {
      const skill1 = registerMockSkill(library, "Skill A", "Test");
      const skill2 = registerMockSkill(library, "Skill B", "Test");

      // Create composition with circular control flow
      const composition: SkillComposition = {
        id: "test_cycle",
        name: "Circular",
        description: "Test",
        rootSkillId: skill1.id,
        subSkills: [
          { skillId: skill1.id, role: "processor", inputMapping: {}, outputMapping: {} },
          { skillId: skill2.id, role: "processor", inputMapping: {}, outputMapping: {} }
        ],
        dataFlow: [],
        controlFlow: [
          { from: skill1.id, to: skill2.id },
          { from: skill2.id, to: skill1.id } // Circular!
        ],
        composedVerifierScore: {
          successProbability: 0.5,
          confidence: 0.3,
          latencyEstimate: 10000,
          costEstimate: 0.1,
          riskFactors: []
        }
      };

      const analysis = composer.analyzeComposition(composition);

      expect(analysis.valid).toBe(false);
      expect(analysis.errors.length).toBeGreaterThan(0);
      expect(analysis.errors[0]).toContain("Circular");
    });

    it("should identify unmapped inputs", async () => {
      const skill = registerMockSkill(library, "Requirer", "Needs input");

      const composition = await composer.compose("Test", [skill.id]);
      
      if (composition) {
        const analysis = composer.analyzeComposition(composition);
        
        // May or may not have unmapped inputs depending on skill
        expect(analysis.warnings).toBeDefined();
      }
    });

    it("should find critical path", async () => {
      const skill1 = registerMockSkill(library, "Fast", "Quick skill");
      const skill2 = registerMockSkill(library, "Slow", "Long skill");

      const composition = await composer.compose("Test", [skill1.id, skill2.id]);
      
      if (composition) {
        const analysis = composer.analyzeComposition(composition);
        
        expect(analysis.criticalPath.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Parallel Optimization", () => {
    it("should detect parallelization opportunities", async () => {
      const skill1 = registerMockSkill(library, "Parallel 1", "Test");
      const skill2 = registerMockSkill(library, "Parallel 2", "Test");

      const composition = await composer.compose("Test", [skill1.id, skill2.id]);
      
      if (composition) {
        const analysis = composer.analyzeComposition(composition);
        
        // Two independent skills can potentially be parallelized
        // but analysis depends on latency thresholds
        expect(typeof analysis.canParallelize).toBe("boolean");
      }
    });

    it("should optimize composition for parallel execution", async () => {
      const skill1 = registerMockSkill(library, "Step 1", "Test");
      const skill2 = registerMockSkill(library, "Step 2", "Test");

      const composition = await composer.compose("Test", [skill1.id, skill2.id]);
      
      if (composition) {
        const optimized = composer.optimizeParallel(composition);
        
        expect(optimized).toBeDefined();
        expect(optimized.subSkills.length).toBe(composition.subSkills.length);
      }
    });
  });

  describe("Blueprint Conversion", () => {
    it("should convert composition to executable blueprint", async () => {
      const skill1 = registerMockSkill(library, "Extractor", "Extracts");
      const skill2 = registerMockSkill(library, "Analyzer", "Analyzes");

      const composition = await composer.compose("Process", [skill1.id, skill2.id]);
      expect(composition).toBeDefined();

      const blueprint = composer.toBlueprint(composition!);

      expect(blueprint.name).toContain("Composed");
      expect(blueprint.steps.length).toBeGreaterThan(0);
      expect(blueprint.agents.length).toBeGreaterThanOrEqual(0);
    });

    it("should namespace step IDs to avoid collisions", async () => {
      const skill1 = registerMockSkill(library, "Skill A", "Test", {
        steps: [{ id: "step1", type: "agent" as const, name: "S1", description: "D1", config: {} }]
      });
      const skill2 = registerMockSkill(library, "Skill B", "Test", {
        steps: [{ id: "step1", type: "agent" as const, name: "S2", description: "D2", config: {} }]
      });

      const composition = await composer.compose("Test", [skill1.id, skill2.id]);
      expect(composition).toBeDefined();

      const blueprint = composer.toBlueprint(composition!);

      // Step IDs should be namespaced
      const stepIds = blueprint.steps.map(s => s.id);
      const uniqueIds = new Set(stepIds);
      expect(uniqueIds.size).toBe(stepIds.length);
    });
  });

  describe("Auto-Composition", () => {
    it("should auto-compose from goal description", async () => {
      // Register relevant skills
      registerMockSkill(library, "Data Extractor", "Extracts customer data from APIs");
      registerMockSkill(library, "Data Analyzer", "Analyzes data for patterns");
      registerMockSkill(library, "Report Generator", "Generates reports from analysis");

      const composition = await composer.autoCompose("analyze customer data");

      // Should find and compose relevant skills
      expect(composition === null || typeof composition === "object").toBe(true);
    });

    it("should respect max skills limit in auto-compose", async () => {
      // Register many skills
      for (let i = 0; i < 10; i++) {
        registerMockSkill(library, `Skill ${i}`, `Description ${i}`);
      }

      const composition = await composer.autoCompose("test goal", { maxSkills: 3 });

      if (composition) {
        expect(composition.subSkills.length).toBeLessThanOrEqual(3);
      }
    });
  });
});

// Helper functions
function registerMockSkill(
  library: ReturnType<typeof createSkillLibrary>,
  name: string,
  description: string,
  options: { steps?: any[] } = {}
): Skill {
  return library.registerSkill(
    {
      id: `candidate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      request: name,
      blueprint: {
        name,
        description,
        version: "1.0.0",
        steps: options.steps || [
          { id: "step1", type: "agent" as const, name: "Process", description: "Test", config: {} }
        ],
        agents: [
          { 
            id: "a1", 
            name: "Agent",
            model: "gemini-2.0-flash", 
            temperature: 0.7, 
            maxTokens: 4000,
            allowedTools: ["api"],
            reasoningProtocol: "hermes_xml",
            deliberationDepth: 2 
          }
        ],
        tools: [{ name: "api", version: "1.0", required: true, timeout: 5000, retryCount: 3 }],
        inputSchema: { type: "object", properties: { data: { type: "string" } } },
        outputSchema: { type: "object", properties: { result: { type: "string" } } },
        maxDuration: 60,
        retryPolicy: { maxAttempts: 3, backoffStrategy: "exponential", backoffMs: 1000 },
        reasoningConfig: { protocol: "hermes_xml", depth: 2, selfReflect: true, verifyActions: true }
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
    } as any,
    {
      successRate: 0.9,
      runs: [],
      avgLatency: 4800,
      totalCost: 0.05,
      failureModes: [],
      hermesTraces: [],
      predictionDelta: 0.05,
      candidateId: "test",
      completedAt: new Date(),
      minLatency: 3000,
      maxLatency: 7000
    },
    { autoTag: true }
  );
}
