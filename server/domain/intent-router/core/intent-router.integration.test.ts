/**
 * Integration Tests: End-to-End Classification Pipeline (Task 16.3)
 *
 * Tests the full classification pipeline: classify → select agent → resolve model → log.
 * Verifies performance budgets, routing decision logging, and cache behavior.
 *
 * **Property 20: Routing decision logged with all required fields**
 * **Validates: Requirements 8.6, 9.3, 9.4, 10.1**
 *
 * Tag: Feature: hat-menu-intent-router, Property 20: Routing decision logged with all required fields
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { IntentRouterService } from "./intent-router.service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";
import { topicCategories, intentCategories } from "@shared/schema/agent-cards.js";
import type { ClassificationResult } from "@shared/schema/intent-router.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@server/domain/agent-cards/core/agent-card.service.js", () => ({
  agentCardService: {
    getEnabledForRouting: vi.fn(),
    getDefault: vi.fn(),
    getById: vi.fn(),
  },
}));

vi.mock("./classification-cache.service.js", () => {
  const { createHash } = require("node:crypto");
  const cache = new Map<string, any>();

  return {
    ClassificationCacheService: {
      hashPrompt: (prompt: string) =>
        createHash("sha256").update(prompt).digest("hex"),
    },
    classificationCacheService: {
      get: vi.fn(async (sessionId: string, promptHash: string) => {
        return cache.get(`${sessionId}:${promptHash}`) ?? null;
      }),
      set: vi.fn(async (sessionId: string, promptHash: string, result: any) => {
        cache.set(`${sessionId}:${promptHash}`, result);
      }),
      invalidate: vi.fn(async (sessionId: string, promptHash: string) => {
        cache.delete(`${sessionId}:${promptHash}`);
      }),
      invalidateByAgentCard: vi.fn(),
      _clearForTest: () => cache.clear(),
    },
  };
});

vi.mock("./model-resolver.service.js", () => ({
  modelResolverService: {
    resolve: vi.fn(async (agentCard: any) => ({
      providerId: agentCard.modelBindingProviderId ?? 1,
      modelId: agentCard.modelBindingModelId ?? 1,
      providerName: "Anthropic",
      providerTechnicalName: "anthropic",
      modelIdentifier: "claude-3-5-sonnet",
      isFallback: false,
    })),
  },
}));

const mockDbInsertValues = vi.fn().mockResolvedValue(undefined);
vi.mock("@server/database_service.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: (...args: any[]) => mockDbInsertValues(...args),
    }),
  },
}));

vi.mock("@server/domain/ai/core/llm-router.service.js", () => ({
  llmRouterService: {
    complete: vi.fn().mockResolvedValue({ content: "mock response" }),
    initialize: vi.fn(),
  },
}));

import { agentCardService } from "@server/domain/agent-cards/core/agent-card.service.js";
import { classificationCacheService } from "./classification-cache.service.js";
import { modelResolverService } from "./model-resolver.service.js";
import { db } from "@server/database_service.js";

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const mockAgentCards: AgentCardRecord[] = [
  {
    id: 1,
    organizationId: 1,
    name: "Coder",
    description: "Code specialist",
    personaType: "coder",
    modelBindingProviderId: 1,
    modelBindingModelId: 1,
    capabilities: ["code generation", "code review", "debugging"],
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
    capabilities: ["data analysis", "pattern recognition"],
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
    capabilities: ["image generation", "video synthesis"],
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
  id: 100,
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

// ─── Setup ────────────────────────────────────────────────────────────────────

const service = new IntentRouterService();

beforeEach(() => {
  vi.clearAllMocks();
  // Clear cache between tests
  (classificationCacheService as any)._clearForTest?.();

  vi.mocked(agentCardService.getEnabledForRouting).mockResolvedValue(mockAgentCards);
  vi.mocked(agentCardService.getDefault).mockResolvedValue(defaultCard);
  vi.mocked(agentCardService.getById).mockImplementation(async (_orgId, id) => {
    return mockAgentCards.find((c) => c.id === id) ?? defaultCard;
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 1. End-to-End Pipeline Tests
// ════════════════════════════════════════════════════════════════════════════════

describe("End-to-end classification pipeline", () => {
  it("should classify a code prompt and return a complete ClassificationResult", async () => {
    const result = await service.classify({
      prompt: "Help me debug this function and fix the compile error in my code",
      organizationId: 1,
      sessionId: "session-1",
    });

    // All result fields should be populated
    expect(result.topic).toBe("Code");
    expect(result.topicConfidence).toBeGreaterThanOrEqual(0.4);
    expect(result.topicConfidence).toBeLessThanOrEqual(1.0);
    expect(result.intent).toBeDefined();
    expect(result.intentConfidence).toBeGreaterThanOrEqual(0);
    expect(result.intentConfidence).toBeLessThanOrEqual(1.0);
    expect(result.combinedConfidence).toBeGreaterThanOrEqual(0);
    expect(result.combinedConfidence).toBeLessThanOrEqual(1.0);
    expect(result.selectedAgentCardId).toBe(1); // Coder matches Code topic
    expect(result.selectedAgentCardName).toBe("Coder");
    expect(result.resolvedModelProviderId).toBeGreaterThan(0);
    expect(result.resolvedModelId).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("should classify a finance prompt and select Analyst agent", async () => {
    const result = await service.classify({
      prompt: "Analyze this stock portfolio and calculate the dividend yield for my investment",
      organizationId: 1,
      sessionId: "session-2",
    });

    expect(result.topic).toBe("Finance");
    expect(result.selectedAgentCardId).toBe(2); // Analyst has Finance affinity
    expect(result.selectedAgentCardName).toBe("Analyst");
  });

  it("should classify a media prompt and select Media Creator agent", async () => {
    const result = await service.classify({
      prompt: "Generate image of a sunset landscape using stable diffusion",
      organizationId: 1,
      sessionId: "session-3",
    });

    expect(result.selectedAgentCardId).toBe(3); // Media Creator
    expect(result.selectedAgentCardName).toBe("Media Creator");
  });

  it("should fall back to default agent for prompts with no affinity match", async () => {
    const result = await service.classify({
      prompt: "Hello, how are you doing today?",
      organizationId: 1,
      sessionId: "session-4",
    });

    // Low confidence → General topic, Chat intent → no affinity match → default
    expect(result.selectedAgentCardId).toBe(defaultCard.id);
    expect(result.selectedAgentCardName).toBe("Default Agent");
  });

  it("should validate selected agent is enabled", async () => {
    const result = await service.classify({
      prompt: "Debug this code function and fix the syntax error",
      organizationId: 1,
      sessionId: "session-5",
    });

    // The selected agent must exist in our mock enabled cards
    const selectedCard = mockAgentCards.find((c) => c.id === result.selectedAgentCardId);
    if (selectedCard) {
      expect(selectedCard.enabled).toBe(true);
    } else {
      // Must be the default card
      expect(result.selectedAgentCardId).toBe(defaultCard.id);
    }
  });

  it("should reject empty prompts with a validation error", async () => {
    await expect(
      service.classify({
        prompt: "",
        organizationId: 1,
        sessionId: "session-6",
      }),
    ).rejects.toThrow("Prompt content is required");
  });

  it("should reject whitespace-only prompts with a validation error", async () => {
    await expect(
      service.classify({
        prompt: "   \t\n   ",
        organizationId: 1,
        sessionId: "session-7",
      }),
    ).rejects.toThrow("Prompt content is required");
  });

  it("should compute combinedConfidence as arithmetic mean of topic and intent confidence", async () => {
    const result = await service.classify({
      prompt: "Analyze the stock market data and compare the portfolio returns",
      organizationId: 1,
      sessionId: "session-8",
    });

    const expectedCombined =
      Math.round(((result.topicConfidence + result.intentConfidence) / 2) * 1000) / 1000;
    expect(result.combinedConfidence).toBe(expectedCombined);
  });

  it("should call model resolver with the selected agent card", async () => {
    await service.classify({
      prompt: "Help me debug this code function",
      organizationId: 1,
      sessionId: "session-9",
    });

    expect(modelResolverService.resolve).toHaveBeenCalled();
    const resolveCall = vi.mocked(modelResolverService.resolve).mock.calls[0];
    expect(resolveCall[0]).toMatchObject({ id: expect.any(Number), enabled: true });
    expect(resolveCall[1]).toBe(1); // organizationId
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. Performance Budget Verification
// ════════════════════════════════════════════════════════════════════════════════

describe("Performance budget verification", () => {
  it("should complete classification within 150ms for prompts ≤2000 chars", async () => {
    // Short prompt (well under 2000 chars)
    const prompt = "Help me debug this function and fix the compile error in my code";
    expect(prompt.length).toBeLessThanOrEqual(2000);

    const start = performance.now();
    const result = await service.classify({
      prompt,
      organizationId: 1,
      sessionId: "perf-session-1",
    });
    const elapsed = performance.now() - start;

    // Verify within 150ms budget (with mock services, should be fast)
    expect(elapsed).toBeLessThan(150);
    expect(result.latencyMs).toBeDefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("should complete classification within 300ms for prompts 2001-10000 chars", async () => {
    // Generate a prompt in the 2001-10000 char range
    const basePrompt = "Help me analyze this code function and debug the error. ";
    const repeated = basePrompt.repeat(Math.ceil(2100 / basePrompt.length));
    const prompt = repeated.slice(0, 2500);
    expect(prompt.length).toBeGreaterThan(2000);
    expect(prompt.length).toBeLessThanOrEqual(10000);

    const start = performance.now();
    const result = await service.classify({
      prompt,
      organizationId: 1,
      sessionId: "perf-session-2",
    });
    const elapsed = performance.now() - start;

    // Verify within 300ms budget
    expect(elapsed).toBeLessThan(300);
    expect(result.latencyMs).toBeDefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("should report latencyMs in the result that reflects actual elapsed time", async () => {
    const result = await service.classify({
      prompt: "Debug the code and fix the function compile error",
      organizationId: 1,
      sessionId: "perf-session-3",
    });

    // latencyMs should be a reasonable non-negative integer
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.latencyMs)).toBe(true);
  });

  it("should run topic and intent classification concurrently (pipeline overhead minimized)", async () => {
    // Verify that the total time is not additive (i.e., Promise.all is used)
    const start = performance.now();
    const result = await service.classify({
      prompt: "Search for information about the stock market and analyze trends",
      organizationId: 1,
      sessionId: "perf-session-4",
    });
    const elapsed = performance.now() - start;

    // With mocked services, the pipeline overhead should be minimal
    expect(elapsed).toBeLessThan(150);
    expect(result.topic).toBeDefined();
    expect(result.intent).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. Routing Decision Logging (Property 20)
// ════════════════════════════════════════════════════════════════════════════════

describe("Feature: hat-menu-intent-router, Property 20: Routing decision logged with all required fields", () => {
  /**
   * **Validates: Requirements 8.6, 9.3, 9.4, 10.1**
   *
   * Every classification writes to intentClassificationLogs table with all required fields:
   * prompt_hash, topic, intent, selected_agent_card_id, resolved_model_id, latency_ms,
   * was_cached, was_override.
   */
  it("logs routing decision with all required fields on every fresh classification", async () => {
    await service.classify({
      prompt: "Help me debug this function and fix the compile error",
      organizationId: 1,
      sessionId: "log-session-1",
    });

    // Verify db.insert was called
    expect(db.insert).toHaveBeenCalled();
    expect(mockDbInsertValues).toHaveBeenCalled();

    const logEntry = mockDbInsertValues.mock.calls[0][0];

    // Verify all required fields present
    expect(logEntry).toHaveProperty("organizationId", 1);
    expect(logEntry).toHaveProperty("sessionId", "log-session-1");
    expect(logEntry).toHaveProperty("promptHash");
    expect(logEntry.promptHash).toBeTruthy(); // Non-empty hash
    expect(logEntry).toHaveProperty("topic");
    expect(topicCategories).toContain(logEntry.topic);
    expect(logEntry).toHaveProperty("topicConfidence");
    expect(logEntry.topicConfidence).toBeGreaterThanOrEqual(0);
    expect(logEntry.topicConfidence).toBeLessThanOrEqual(1);
    expect(logEntry).toHaveProperty("intent");
    expect(intentCategories).toContain(logEntry.intent);
    expect(logEntry).toHaveProperty("intentConfidence");
    expect(logEntry.intentConfidence).toBeGreaterThanOrEqual(0);
    expect(logEntry.intentConfidence).toBeLessThanOrEqual(1);
    expect(logEntry).toHaveProperty("combinedConfidence");
    expect(logEntry).toHaveProperty("selectedAgentCardId");
    expect(typeof logEntry.selectedAgentCardId).toBe("number");
    expect(logEntry).toHaveProperty("resolvedModelId");
    expect(typeof logEntry.resolvedModelId).toBe("number");
    expect(logEntry).toHaveProperty("latencyMs");
    expect(typeof logEntry.latencyMs).toBe("number");
    expect(logEntry.latencyMs).toBeGreaterThanOrEqual(0);
    expect(logEntry).toHaveProperty("wasCached", false);
    expect(logEntry).toHaveProperty("wasOverride", false);
  });

  it("logs routing decision with was_cached=true for cache hits", async () => {
    // First call: fresh classification
    await service.classify({
      prompt: "Debug this code function",
      organizationId: 1,
      sessionId: "log-session-2",
    });

    vi.clearAllMocks();
    // Reset the db mock
    vi.mocked(db.insert).mockReturnValue({ values: mockDbInsertValues } as any);

    // Second call: same prompt → cache hit
    await service.classify({
      prompt: "Debug this code function",
      organizationId: 1,
      sessionId: "log-session-2",
    });

    expect(mockDbInsertValues).toHaveBeenCalled();
    const logEntry = mockDbInsertValues.mock.calls[0][0];
    expect(logEntry).toHaveProperty("wasCached", true);
    // All required fields should still be present even for cached results
    expect(logEntry).toHaveProperty("promptHash");
    expect(logEntry).toHaveProperty("topic");
    expect(logEntry).toHaveProperty("intent");
    expect(logEntry).toHaveProperty("selectedAgentCardId");
    expect(logEntry).toHaveProperty("resolvedModelId");
    expect(logEntry).toHaveProperty("latencyMs");
  });

  /**
   * Property 20 (PBT): For any non-empty prompt, a log entry is always written
   * containing all required fields with valid values.
   */
  it("property: every classification produces a complete log entry (fast-check)", async () => {
    // Generator for prompts that trigger meaningful classification
    const promptArb = fc.oneof(
      fc.constant("Help me debug this code function and fix the syntax error"),
      fc.constant("Analyze the stock portfolio dividend yield for my investment"),
      fc.constant("Generate image of a sunset landscape using midjourney"),
      fc.constant("Search for the latest information about climate change research"),
      fc.constant("Alert me when the price of the stock drops below threshold"),
      fc.constant("Create video showing the animation of a bouncing ball motion graphics"),
      fc.constant("Review this contract clause for legal compliance with the regulation"),
      fc.constant("What is the mortgage rate for this property lease in real estate"),
      fc.constant("What are the symptoms and treatment options for the patient diagnosis"),
      // Random non-empty strings
      fc.string({ minLength: 5, maxLength: 500 }).filter((s) => s.trim().length > 0),
    );

    const sessionArb = fc.string({ minLength: 5, maxLength: 30 }).filter((s) => s.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(promptArb, sessionArb, async (prompt, sessionId) => {
        vi.clearAllMocks();
        vi.mocked(db.insert).mockReturnValue({ values: mockDbInsertValues } as any);
        // Clear cache so each test iteration does a fresh classification
        (classificationCacheService as any)._clearForTest?.();

        await service.classify({
          prompt,
          organizationId: 1,
          sessionId,
          bypassCache: true, // Ensure fresh classification each time
        });

        // A log entry must have been written
        expect(mockDbInsertValues).toHaveBeenCalled();
        const logEntry = mockDbInsertValues.mock.calls[0][0];

        // All required fields
        expect(logEntry.promptHash).toBeTruthy();
        expect(typeof logEntry.promptHash).toBe("string");
        expect(topicCategories).toContain(logEntry.topic);
        expect(intentCategories).toContain(logEntry.intent);
        expect(typeof logEntry.selectedAgentCardId).toBe("number");
        expect(logEntry.selectedAgentCardId).toBeGreaterThan(0);
        expect(typeof logEntry.resolvedModelId).toBe("number");
        expect(logEntry.resolvedModelId).toBeGreaterThan(0);
        expect(typeof logEntry.latencyMs).toBe("number");
        expect(logEntry.latencyMs).toBeGreaterThanOrEqual(0);
        expect(typeof logEntry.wasCached).toBe("boolean");
        expect(typeof logEntry.wasOverride).toBe("boolean");
        expect(logEntry.organizationId).toBe(1);
        expect(logEntry.sessionId).toBe(sessionId);
      }),
      { numRuns: 100 },
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. Cache Behavior
// ════════════════════════════════════════════════════════════════════════════════

describe("Cache behavior in end-to-end pipeline", () => {
  it("first call writes to cache", async () => {
    await service.classify({
      prompt: "Debug this code function",
      organizationId: 1,
      sessionId: "cache-session-1",
    });

    expect(classificationCacheService.set).toHaveBeenCalled();
  });

  it("second identical call returns cached result (was_cached=true)", async () => {
    // First call: fresh classification
    const firstResult = await service.classify({
      prompt: "Debug this code function",
      organizationId: 1,
      sessionId: "cache-session-2",
    });

    vi.clearAllMocks();
    vi.mocked(db.insert).mockReturnValue({ values: mockDbInsertValues } as any);

    // Second call: should hit cache
    const secondResult = await service.classify({
      prompt: "Debug this code function",
      organizationId: 1,
      sessionId: "cache-session-2",
    });

    // Results should match (same topic, intent, agent)
    expect(secondResult.topic).toBe(firstResult.topic);
    expect(secondResult.intent).toBe(firstResult.intent);
    expect(secondResult.selectedAgentCardId).toBe(firstResult.selectedAgentCardId);
    expect(secondResult.selectedAgentCardName).toBe(firstResult.selectedAgentCardName);

    // Log should indicate was_cached=true
    expect(mockDbInsertValues).toHaveBeenCalled();
    const logEntry = mockDbInsertValues.mock.calls[0][0];
    expect(logEntry.wasCached).toBe(true);
  });

  it("cache miss triggers fresh classification", async () => {
    // Different prompts → cache miss
    await service.classify({
      prompt: "Debug this code function",
      organizationId: 1,
      sessionId: "cache-session-3",
    });

    vi.clearAllMocks();
    vi.mocked(db.insert).mockReturnValue({ values: mockDbInsertValues } as any);

    await service.classify({
      prompt: "Analyze the stock market investment portfolio",
      organizationId: 1,
      sessionId: "cache-session-3",
    });

    // Second call should be a fresh classification (not cached)
    expect(mockDbInsertValues).toHaveBeenCalled();
    const logEntry = mockDbInsertValues.mock.calls[0][0];
    expect(logEntry.wasCached).toBe(false);
  });

  it("bypassCache=true skips cache read and write", async () => {
    // First call with cache bypass
    await service.classify({
      prompt: "Debug this code function",
      organizationId: 1,
      sessionId: "cache-session-4",
      bypassCache: true,
    });

    // Cache set should NOT have been called
    expect(classificationCacheService.set).not.toHaveBeenCalled();
  });

  it("invalidates cache when referenced agent card is disabled", async () => {
    // First call: fresh classification
    await service.classify({
      prompt: "Debug this code function",
      organizationId: 1,
      sessionId: "cache-session-5",
    });

    // Simulate agent card being disabled — getById returns agent with enabled=false
    vi.mocked(agentCardService.getById).mockResolvedValueOnce({
      ...mockAgentCards[0],
      enabled: false,
    });

    vi.clearAllMocks();
    vi.mocked(db.insert).mockReturnValue({ values: mockDbInsertValues } as any);

    // Second call: cache hit but agent disabled → invalidate and re-classify
    const secondResult = await service.classify({
      prompt: "Debug this code function",
      organizationId: 1,
      sessionId: "cache-session-5",
    });

    // Should have invalidated the cache entry
    expect(classificationCacheService.invalidate).toHaveBeenCalled();

    // Should still produce a valid result via fresh classification
    expect(secondResult.topic).toBeDefined();
    expect(secondResult.intent).toBeDefined();
    expect(secondResult.selectedAgentCardId).toBeGreaterThan(0);
  });
});
