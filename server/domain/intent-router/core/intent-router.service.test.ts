/**
 * Unit Tests: Intent Router Classification Service (Task 5.2)
 *
 * Tests for classifyTopic() and classifyIntent() methods covering:
 * - Input validation (empty/whitespace prompts)
 * - Keyword-based classification into correct categories
 * - Confidence threshold behavior (< 0.4 defaults to General/Chat)
 * - Concurrent execution via Promise.all
 *
 * **Validates: Requirements 6.1–6.5, 7.1–7.6**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { IntentRouterService } from "./intent-router.service.js";
import { agentCardService } from "@server/domain/agent-cards/core/agent-card.service.js";
import { theoryOfMindService } from "@server/domain/agents/core/theory-of-mind.service.js";
import { modelResolverService } from "./model-resolver.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";

vi.mock("@server/domain/agent-cards/core/agent-card.service.js", () => ({
  agentCardService: {
    getEnabledForRouting: vi.fn(),
    getDefault: vi.fn(),
  },
}));

vi.mock("./classification-cache.service.js", () => ({
  ClassificationCacheService: {
    hashPrompt: vi.fn((prompt: string) => `hash_${prompt.slice(0, 10)}`),
  },
  classificationCacheService: {
    get: vi.fn(),
    set: vi.fn(),
    invalidate: vi.fn(),
    invalidateByAgentCard: vi.fn(),
  },
}));

vi.mock("./model-resolver.service.js", () => ({
  modelResolverService: {
    resolve: vi.fn(),
  },
}));

vi.mock("@server/database_service.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@server/domain/ai/core/llm-router.service.js", () => ({
  llmRouterService: {
    complete: vi.fn(),
    initialize: vi.fn(),
  },
}));

vi.mock("@server/domain/agents/core/theory-of-mind.service.js", () => ({
  theoryOfMindService: {
    getCognitiveState: vi.fn(),
  },
}));

describe("IntentRouterService", () => {
  const service = new IntentRouterService();

  // ==========================================================================
  // classifyTopic()
  // ==========================================================================

  describe("classifyTopic()", () => {
    it("should reject empty string with a ValidationError", async () => {
      await expect(service.classifyTopic("")).rejects.toThrow(
        "Prompt content is required"
      );
    });

    it("should reject whitespace-only string with a ValidationError", async () => {
      await expect(service.classifyTopic("   \t\n  ")).rejects.toThrow(
        "Prompt content is required"
      );
    });

    it("should classify a code-related prompt as Code", async () => {
      const result = await service.classifyTopic(
        "Help me debug this function and fix the compile error"
      );
      expect(result.topic).toBe("Code");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it("should classify a real estate prompt correctly", async () => {
      const result = await service.classifyTopic(
        "What is the mortgage rate for this property lease?"
      );
      expect(result.topic).toBe("Real Estate");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should classify a legal prompt correctly", async () => {
      const result = await service.classifyTopic(
        "Review this contract clause for compliance with the regulation"
      );
      expect(result.topic).toBe("Legal");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should classify a media prompt correctly", async () => {
      const result = await service.classifyTopic(
        "Help me with video editing and animation production"
      );
      expect(result.topic).toBe("Media");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should classify a finance prompt correctly", async () => {
      const result = await service.classifyTopic(
        "Analyze this stock portfolio and calculate the dividend yield"
      );
      expect(result.topic).toBe("Finance");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should classify a health prompt correctly", async () => {
      const result = await service.classifyTopic(
        "What are the symptoms and treatment options for the patient diagnosis?"
      );
      expect(result.topic).toBe("Health");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should return General for an ambiguous prompt with low confidence", async () => {
      const result = await service.classifyTopic(
        "Tell me something interesting about the weather today and what happened in the world"
      );
      expect(result.topic).toBe("General");
      expect(result.confidence).toBeLessThan(0.4);
    });

    it("should produce confidence between 0.0 and 1.0", async () => {
      const result = await service.classifyTopic("debug the code function");
      expect(result.confidence).toBeGreaterThanOrEqual(0.0);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it("should select exactly one topic category", async () => {
      const result = await service.classifyTopic(
        "Write a function to calculate mortgage payments"
      );
      // Even though this spans Code and Real Estate, should select exactly one
      const validTopics = [
        "Code", "Real Estate", "Legal", "Media", "Finance", "Health", "General",
      ];
      expect(validTopics).toContain(result.topic);
    });
  });

  // ==========================================================================
  // classifyIntent()
  // ==========================================================================

  describe("classifyIntent()", () => {
    it("should return Chat at 1.0 for empty string", async () => {
      const result = await service.classifyIntent("");
      expect(result.intent).toBe("Chat");
      expect(result.confidence).toBe(1.0);
    });

    it("should return Chat at 1.0 for whitespace-only string", async () => {
      const result = await service.classifyIntent("   \t\n  ");
      expect(result.intent).toBe("Chat");
      expect(result.confidence).toBe(1.0);
    });

    it("should classify image generation intent", async () => {
      const result = await service.classifyIntent(
        "Generate image of a sunset over the ocean"
      );
      expect(result.intent).toBe("Image Generation");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should classify video intent", async () => {
      const result = await service.classifyIntent(
        "Create video showing the animation of a bouncing ball"
      );
      expect(result.intent).toBe("Video");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should classify code execution intent", async () => {
      const result = await service.classifyIntent(
        "Run this code and execute the function"
      );
      expect(result.intent).toBe("Code Execution");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should classify analysis intent", async () => {
      const result = await service.classifyIntent(
        "Analyze this data and compare the results to evaluate trends"
      );
      expect(result.intent).toBe("Analysis");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should classify alert intent", async () => {
      const result = await service.classifyIntent(
        "Alert me when the price drops and notify me of changes"
      );
      expect(result.intent).toBe("Alert");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should classify search intent", async () => {
      const result = await service.classifyIntent(
        "Search for information about climate change and find me the latest research"
      );
      expect(result.intent).toBe("Search");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });

    it("should return Chat for an ambiguous prompt with low confidence", async () => {
      const result = await service.classifyIntent(
        "Hello how are you doing today I just wanted to say hi and chat about life"
      );
      expect(result.intent).toBe("Chat");
      expect(result.confidence).toBeLessThan(0.4);
    });

    it("should produce confidence between 0.0 and 1.0", async () => {
      const result = await service.classifyIntent(
        "Generate image of a cat"
      );
      expect(result.confidence).toBeGreaterThanOrEqual(0.0);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it("should select exactly one intent category", async () => {
      const result = await service.classifyIntent(
        "Search for information and analyze it"
      );
      const validIntents = [
        "Image Generation", "Video", "Code Execution",
        "Analysis", "Alert", "Chat", "Search",
      ];
      expect(validIntents).toContain(result.intent);
    });

    it("should break ties by registered category order (earlier wins)", async () => {
      // Test tie-breaking: prompt that matches Image Generation and Video equally.
      // "generate image" + "draw" + "create picture" = 3 for Image Generation
      // "create video" + "generate video" + "make a video" = 3 for Video
      // Image Generation is earlier in registered order, so it should win on tie.
      const result = await service.classifyIntent(
        "generate image draw create picture create video generate video make a video"
      );
      // Image Generation appears first in the registered order and wins ties
      expect(result.intent).toBe("Image Generation");
    });
  });

  // ==========================================================================
  // Concurrent execution
  // ==========================================================================

  describe("concurrent classification", () => {
    it("should run topic and intent classification concurrently via Promise.all", async () => {
      const prompt = "Debug the function that generates images";

      const [topicResult, intentResult] = await Promise.all([
        service.classifyTopic(prompt),
        service.classifyIntent(prompt),
      ]);

      expect(topicResult.topic).toBeDefined();
      expect(topicResult.confidence).toBeGreaterThanOrEqual(0.0);
      expect(topicResult.confidence).toBeLessThanOrEqual(1.0);

      expect(intentResult.intent).toBeDefined();
      expect(intentResult.confidence).toBeGreaterThanOrEqual(0.0);
      expect(intentResult.confidence).toBeLessThanOrEqual(1.0);
    });

    it("should handle topic rejection while intent succeeds in Promise.allSettled", async () => {
      const results = await Promise.allSettled([
        service.classifyTopic(""),
        service.classifyIntent(""),
      ]);

      expect(results[0].status).toBe("rejected");
      expect(results[1].status).toBe("fulfilled");
      if (results[1].status === "fulfilled") {
        expect(results[1].value.intent).toBe("Chat");
        expect(results[1].value.confidence).toBe(1.0);
      }
    });
  });

  // ==========================================================================
  // selectAgent()
  // ==========================================================================

  describe("selectAgent()", () => {
    const mockCards: AgentCardRecord[] = [
      {
        id: 1,
        organizationId: 1,
        name: "Coder",
        description: "Code specialist",
        personaType: "coder",
        modelBindingProviderId: 1,
        modelBindingModelId: 1,
        capabilities: ["code generation"],
        tools: [],
        topicAffinities: ["Code"],
        topicLabelAffinities: [],
        intentAffinities: ["Code Execution", "Analysis"],
        enabled: true,
        isDefault: false,
        oceanTraits: { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 },
        soulArchetype: null,
        legend: null,
        approvalBoundary: null,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
      {
        id: 2,
        organizationId: 1,
        name: "Analyst",
        description: "Analysis specialist",
        personaType: "analyst",
        modelBindingProviderId: 1,
        modelBindingModelId: 2,
        capabilities: ["data analysis"],
        tools: [],
        topicAffinities: ["Finance", "Real Estate", "Legal"],
        topicLabelAffinities: [],
        intentAffinities: ["Analysis", "Alert"],
        enabled: true,
        isDefault: false,
        oceanTraits: { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 },
        soulArchetype: null,
        legend: null,
        approvalBoundary: null,
        createdAt: new Date("2024-01-02"),
        updatedAt: new Date("2024-01-02"),
      },
      {
        id: 3,
        organizationId: 1,
        name: "Media Creator",
        description: "Media specialist",
        personaType: "media",
        modelBindingProviderId: 2,
        modelBindingModelId: 3,
        capabilities: ["image generation"],
        tools: [],
        topicAffinities: ["Media"],
        topicLabelAffinities: [],
        intentAffinities: ["Image Generation", "Video"],
        enabled: true,
        isDefault: false,
        oceanTraits: { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 },
        soulArchetype: null,
        legend: null,
        approvalBoundary: null,
        createdAt: new Date("2024-01-03"),
        updatedAt: new Date("2024-01-03"),
      },
    ];

    const defaultCard: AgentCardRecord = {
      id: 10,
      organizationId: 1,
      name: "Default Agent",
      description: "Default fallback agent",
      personaType: "general",
      modelBindingProviderId: 1,
      modelBindingModelId: 1,
      capabilities: ["general"],
      tools: [],
      topicAffinities: [],
      topicLabelAffinities: [],
      intentAffinities: [],
      enabled: true,
      isDefault: true,
      oceanTraits: { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 },
      soulArchetype: null,
      legend: null,
      approvalBoundary: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    };

    beforeEach(() => {
      vi.mocked(agentCardService.getEnabledForRouting).mockResolvedValue(mockCards);
      vi.mocked(agentCardService.getDefault).mockResolvedValue(defaultCard);
    });

    it("should select agent with highest affinity score (score 2: topic + intent match)", async () => {
      // Coder has both Code topic and Code Execution intent = score 2
      const result = await service.selectAgent(1, "Code", "Code Execution");
      expect(result.id).toBe(1);
      expect(result.name).toBe("Coder");
    });

    it("should score +1 for topic match only", async () => {
      // Media Creator has Media topic but NOT Search intent = score 1
      // No other card has Media topic
      const result = await service.selectAgent(1, "Media", "Search");
      expect(result.id).toBe(3);
      expect(result.name).toBe("Media Creator");
    });

    it("should score +1 for intent match only", async () => {
      // General topic doesn't match anyone, but Image Generation intent matches Media Creator
      const result = await service.selectAgent(1, "General", "Image Generation");
      expect(result.id).toBe(3);
      expect(result.name).toBe("Media Creator");
    });

    it("should tie-break by lowest ID when scores are equal", async () => {
      // Both Coder (id=1) and Analyst (id=2) have Analysis intent affinity
      // For Health topic: neither match topic. Both match intent = score 1 each
      // Tie-break: lowest ID = Coder (id=1)
      const result = await service.selectAgent(1, "Health", "Analysis");
      expect(result.id).toBe(1);
      expect(result.name).toBe("Coder");
    });

    it("should fall back to org default when no card has score > 0", async () => {
      // General topic and Chat intent: no card matches either
      const result = await service.selectAgent(1, "General", "Chat");
      expect(result.id).toBe(10);
      expect(result.name).toBe("Default Agent");
      expect(agentCardService.getDefault).toHaveBeenCalledWith(1);
    });

    it("should fall back to org default when enabled cards list is empty", async () => {
      vi.mocked(agentCardService.getEnabledForRouting).mockResolvedValue([]);
      const result = await service.selectAgent(1, "Code", "Code Execution");
      expect(result.id).toBe(10);
      expect(result.name).toBe("Default Agent");
    });

    it("should prefer higher score over lower ID", async () => {
      // Analyst (id=2) has score 2 for Finance + Analysis
      // Coder (id=1) has score 1 for Analysis intent only
      const result = await service.selectAgent(1, "Finance", "Analysis");
      expect(result.id).toBe(2);
      expect(result.name).toBe("Analyst");
    });
  });

  // ==========================================================================
  // classifyWithCognitiveState()
  // ==========================================================================

  describe("classifyWithCognitiveState()", () => {
    const mockCard: AgentCardRecord = {
      id: 1,
      organizationId: 1,
      name: "Default Assistant",
      description: "Default assistant",
      personaType: "general",
      modelBindingProviderId: 1,
      modelBindingModelId: 1,
      capabilities: ["general"],
      tools: [],
      topicAffinities: ["General"],
      topicLabelAffinities: [],
      intentAffinities: ["Chat"],
      enabled: true,
      isDefault: true,
      oceanTraits: { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 },
      soulArchetype: null,
      legend: null,
      approvalBoundary: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      vi.mocked(agentCardService.getEnabledForRouting).mockResolvedValue([mockCard]);
      vi.mocked(agentCardService.getDefault).mockResolvedValue(mockCard);
      vi.mocked(modelResolverService.resolve).mockResolvedValue({
        providerId: 1,
        modelId: 1,
        providerName: "OpenAI",
        providerTechnicalName: "openai",
        modelIdentifier: "gpt-4o",
        isFallback: false,
      });
    });

    it("should classify normally with default cognitive modulation when userId is omitted", async () => {
      const result = await service.classifyWithCognitiveState({
        prompt: "Hello world, what is the weather today?",
        organizationId: 1,
        sessionId: "sess-1",
        bypassCache: true,
      });

      expect(result.topic).toBeDefined();
      expect(result.intent).toBeDefined();
      expect(result.cognitiveModulation).toBeDefined();
      expect(result.cognitiveModulation.escalateToHuman).toBe(false);
      expect(result.cognitiveModulation.autonomyLevel).toBe("autonomous");
      expect(result.cognitiveModulation.recommendedPersona).toBe("default");
      expect(result.cognitiveModulation.cognitiveSnapshot.frustration).toBe(0);
    });

    it("should escalate to human and restrict autonomy when frustration is high", async () => {
      vi.mocked(theoryOfMindService.getCognitiveState).mockResolvedValue({
        frustration: 80,
        confusion: 20,
        urgency: 40,
        explorationVsGoal: 50,
        assessedAt: new Date().toISOString(),
      });

      const result = await service.classifyWithCognitiveState({
        prompt: "This is broken again, fix it immediately",
        organizationId: 1,
        sessionId: "sess-frustrated",
        userId: "user-frustrated",
        bypassCache: true,
      });

      expect(result.cognitiveModulation.escalateToHuman).toBe(true);
      expect(result.cognitiveModulation.autonomyLevel).toBe("human_approval_required");
      expect(result.cognitiveModulation.recommendedPersona).toBe("direct_concise");
      expect(result.cognitiveModulation.guidancePrompt).toContain("elevated frustration/urgency");
    });

    it("should escalate to human when urgency is critical (>= 85)", async () => {
      vi.mocked(theoryOfMindService.getCognitiveState).mockResolvedValue({
        frustration: 20,
        confusion: 10,
        urgency: 90,
        explorationVsGoal: 50,
        assessedAt: new Date().toISOString(),
      });

      const result = await service.classifyWithCognitiveState({
        prompt: "Production DB is down, alert everyone",
        organizationId: 1,
        sessionId: "sess-urgent",
        userId: "user-urgent",
        bypassCache: true,
      });

      expect(result.cognitiveModulation.escalateToHuman).toBe(true);
      expect(result.cognitiveModulation.autonomyLevel).toBe("human_approval_required");
      expect(result.cognitiveModulation.recommendedPersona).toBe("direct_concise");
    });

    it("should recommend structured_clarifier and supervised autonomy when confusion is elevated (>= 60)", async () => {
      vi.mocked(theoryOfMindService.getCognitiveState).mockResolvedValue({
        frustration: 30,
        confusion: 70,
        urgency: 30,
        explorationVsGoal: 50,
        assessedAt: new Date().toISOString(),
      });

      const result = await service.classifyWithCognitiveState({
        prompt: "I am confused by how this deployment pipeline works",
        organizationId: 1,
        sessionId: "sess-confused",
        userId: "user-confused",
        bypassCache: true,
      });

      expect(result.cognitiveModulation.escalateToHuman).toBe(false);
      expect(result.cognitiveModulation.autonomyLevel).toBe("supervised");
      expect(result.cognitiveModulation.recommendedPersona).toBe("structured_clarifier");
      expect(result.cognitiveModulation.guidancePrompt).toContain("numbered checklists");
    });

    it("should recommend empathic_orchestrator when in exploratory mode (explorationVsGoal >= 70)", async () => {
      vi.mocked(theoryOfMindService.getCognitiveState).mockResolvedValue({
        frustration: 10,
        confusion: 15,
        urgency: 10,
        explorationVsGoal: 85,
        assessedAt: new Date().toISOString(),
      });

      const result = await service.classifyWithCognitiveState({
        prompt: "What are some possible ways we could architect our microservices?",
        organizationId: 1,
        sessionId: "sess-explore",
        userId: "user-explorer",
        bypassCache: true,
      });

      expect(result.cognitiveModulation.escalateToHuman).toBe(false);
      expect(result.cognitiveModulation.autonomyLevel).toBe("autonomous");
      expect(result.cognitiveModulation.recommendedPersona).toBe("empathic_orchestrator");
      expect(result.cognitiveModulation.guidancePrompt).toContain("divergent architectural options");
    });
  });
});
